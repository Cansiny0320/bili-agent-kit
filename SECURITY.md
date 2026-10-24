# Security and recovery

## Trust boundary

bili-agent-kit is a local library and process, not an identity provider or a shell sandbox. SDK callers and CLI administrators are trusted. MCP clients may invoke only the public operation registry, which deliberately omits approval, policy modification, credential management, reconciliation and account resume. Supplying `approved: true` fails schema validation.

Separate the MCP process's credentials/state from model-controlled shell and filesystem access. A model that can run the administrator CLI, edit the state/config, replace the executable, or read the Cookie can bypass policy. The `by` field on approval is an audit label, not administrator authentication. A shared operating-system account without isolation is not a security boundary.

Policy is copied and validated at startup. Restart the service after changing it. A policy-file edit does not revoke an in-flight send. Credential providers are trusted and may rotate credentials; an account fingerprint change invalidates the old draft. Do not intentionally run one account against multiple independent state directories: that splits budgets and idempotency records.

## State and network

FileStore uses a local lock, fsynced temporary state, atomic rename and directory fsync where supported. State transactions are synchronous; the lock never covers network I/O. Only use local filesystems with atomic rename/creation semantics. Network shares and multi-host coordination are unsupported. POSIX modes are 0700/0600; Windows requires appropriate directory ACLs. The files are not encrypted. Keep backups private because drafts and pending DMs contain personal content.

Corrupt/incompatible state is never automatically reset. Lock contention fails closed after a bounded wait. A leftover `state.json.lock` must be reviewed manually: stop all processes using the directory, verify the recorded owner is no longer running, back up state, then remove only that lock. Do not delete `state.json` to clear an error. A power failure or filesystem malfunction can still lose data; no local file implementation can promise end-to-end exactly-once external effects.

Requests are spaced at least 1,500 ms and share a persistent dispatch lease. Budgets are per account: 600 reads/hour, 3,000 reads/day, 12 writes/hour, 30 writes/day. Write cooldown is 120 seconds, or 60 seconds for DMs. These are conservative local limits, not a promise of platform acceptance. Window counters reset after their elapsed duration; counters include reservations and failed attempts. Repeated runs and signed-key requests consume the same budget.

HTTP 412/429 and platform risk codes trigger persistent exponential backoff from 5 to 30 minutes, respecting a longer Retry-After. Login/captcha codes require administrator review. There is no automatic network retry. All requests have a 30-second timeout, JSON response size limits and redirects disabled. API origins are fixed. Subtitle downloads accept HTTPS Bilibili/hdslb hosts and carry no account Cookie. Errors omit raw upstream bodies and known credentials; no request logger is enabled.

## Approval and uncertain sends

Drafts bind content, target, account fingerprint and idempotency key. Approval binds the reviewed digest and expires with the draft after one hour. All write operations require the allowlist and persistent store. DM reads require trusted targets; sends also check mutual follows. A sending reservation is saved before dispatch. The safety guarantee concerns repeated execution with the same account and idempotency key; deliberately creating new keys or deleting state defeats deduplication.

If a request may have left the process but its outcome is not known, the draft remains `sending` or `unknown`. Never automatically retry it. A typed nonzero platform rejection is recorded as `rejected`; revise or prepare a new key only after reviewing the cause. A successfully acknowledged send is `sent`, which means Bilibili accepted the request, not a guarantee of visibility after moderation.

For a `sending`/`unknown` draft:

1. Stop the originating worker and ensure no request is still in flight. Preserve the draft and state.
2. Read the relevant conversation/comment/live history, or inspect it manually. Recent live history can be incomplete; absence alone is not proof that a message was not sent.
3. From a trusted administrator shell, reconcile only when the outcome is established:

```sh
node packages/cli/dist/main.mjs --config config.local.json admin.reconcile '{"draftId":"<id>","outcome":"sent"}'
```

Use `not-sent` only with evidence. That restores the same immutable draft to `draft` with a new one-hour expiry, clears approval and requires a fresh approval before execution. Reconciliation is not available to MCP. Do not reconcile a live worker's `sending` operation.

After manually resolving a login/captcha problem, `admin.resume` with `{}` clears that account's manual pause. It does not clear risk backoff or budgets. A read-only operation can verify the account afterward. No command bypasses captcha or resets platform backoff.

## Verification scope

Regression tests use fixture credentials, injected fetch/clock and temporary directories. Tests cover protocol signing, endpoint fields, approval and account binding, persistent uncertain outcomes, concurrent reservations, rate limits, credential isolation, cursor replay/ack, CLI and MCP protocol. Package smoke tests install local tarballs and exercise built entrypoints. No real Bilibili account or external write is used by the test suite. Mock tests cannot establish current live API compatibility.

ffmpeg is optional and not bundled. Local input containment, argument validation and process invocation are tested without decoding real media. Host operators should validate their chosen ffmpeg binary and sandbox untrusted media. The initial Windows validation environment did not have ffmpeg on PATH.

## Reporting

For a security issue, use the repository's private vulnerability reporting if available, or contact the maintainer through the GitHub profile before publishing sensitive details. Do not include Cookies, private messages, credential files or state dumps in public issues.
