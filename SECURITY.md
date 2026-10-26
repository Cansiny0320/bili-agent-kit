# Security and recovery

## Trust boundary

bili-agent-kit is a local library and process, not an identity provider or a shell sandbox. SDK callers and CLI administrators are trusted. MCP clients may invoke the public operation registry and optional phone-confirmed QR login/status/cancel tools. Approval, policy modification, credential export, logout, refresh, OAuth management, reconciliation and account resume remain unavailable through MCP. Supplying `approved: true` fails schema validation.

Separate the MCP process's credentials/state from model-controlled shell and filesystem access. A model that can run the administrator CLI, edit the state/config, replace the executable, or read the Cookie can bypass policy. The `by` field on approval is an audit label, not administrator authentication. A shared operating-system account without isolation is not a security boundary.

Policy is copied and validated at startup. Restart the service after changing it. A policy-file edit does not revoke an in-flight send. Credential providers are trusted and may rotate credentials; an account fingerprint change invalidates the old draft. Do not intentionally run one account against multiple independent state directories: that splits budgets and idempotency records.

## State and network

FileStore uses a local lock, fsynced temporary state, atomic rename and directory fsync where supported. State transactions are synchronous; the lock never covers network I/O. Only use local filesystems with atomic rename/creation semantics. Network shares and multi-host coordination are unsupported. POSIX modes are 0700/0600; Windows requires appropriate directory ACLs. The files are not encrypted. Keep backups private because drafts and pending events contain personal content, and resumable uploads contain temporary upload tokens. Public draft and administrator results redact those tokens.

Corrupt/incompatible state is never automatically reset. Lock contention fails closed after a bounded wait. A leftover `state.json.lock` must be reviewed manually: stop all processes using the directory, verify the recorded owner is no longer running, back up state, then remove only that lock. Do not delete `state.json` to clear an error. A power failure or filesystem malfunction can still lose data; no local file implementation can promise end-to-end exactly-once external effects.

Requests are spaced at least 1,500 ms and share a persistent dispatch lease. Budgets are per account: 600 reads/hour, 3,000 reads/day, 12 writes/hour, 30 writes/day. Ordinary writes have no additional cooldown; DMs retain a 60-second cooldown. These are local limits, not a promise of platform acceptance. Window counters reset after their elapsed duration; counters include reservations and failed attempts. Repeated runs and signed-key requests consume the same budget. A multi-step approved draft consumes one logical write reservation; its upload parts, content checks and final submission share that reservation. Every request still obeys dispatch spacing and platform backoff. A different draft has a separate reservation.

HTTP 412/429 and platform risk codes trigger persistent exponential backoff from 5 to 30 minutes, respecting a longer Retry-After. Login/captcha codes require administrator review. There is no automatic network retry. Tool requests have a 30-second timeout, bounded response sizes and redirects disabled. Only the video short-link resolver inspects up to three redirects against its fixed host allowlist. API origins are fixed. Subtitle and media CDN downloads use HTTPS host allowlists and carry no account Cookie. Errors omit raw upstream bodies and known credentials; no request logger is enabled.

## QR login and credential files

MCP QR login requires the user to scan and confirm on their phone. It returns a native QR image and sanitized progress/account data, never raw cookies, refresh tokens or challenge keys. A valid login is reused; replacing it requires a trusted CLI logout first. One bounded login runs per connection; cancellation, expiry and connection close release the credential lock without deleting saved credentials. Trusted SDK hosts may also call FileAuth directly. Only the fixed Bilibili passport and API origins receive login requests; redirects are disabled. Login requests use 15-second timeouts, bounded JSON and at least 2-second spacing. They are separate from tool traffic so expired sessions can be replaced; login neither clears persisted backoff/manual pauses nor enables writes. Each challenge has a 3-minute local lifetime. Risk/captcha responses stop the login rather than retrying. QR login retains an optional refresh token. Explicit trusted `auth.refresh-check` and `auth.refresh` commands manage renewal; no timer refreshes a session in the background. A private `.refresh.json` journal records requesting/received phases. New credentials are verified against the current UID and saved before confirming the previous token is invalidated. Interrupted confirmation can resume; an uncertain rotation is not blindly retried and may require a new QR login.

CLI QR/progress is written only to stderr. The raw SDK login result intentionally contains credentials for private host storage; do not expose it as a model tool. CLI success/status includes only authentication state, UID and name. Generated PNGs contain an ephemeral login challenge and have private file permissions; keep them out of logs and source control.

Without an explicit config, CLI/MCP/SDK loaders share `~/.bili-agent-kit/config.json`, `credentials.json` and `state/`, independent of the working directory. Initialization atomically publishes a new private config without overwriting an existing one. Explicit missing/invalid configs fail without falling back to the default account. No browser or existing project credentials are imported. Writes remain disabled by default.

Credential files are plaintext. Newly saved files have POSIX 0600 permissions or a protected Windows ACL granting only the current SID. Data is written after permissions are applied, fsynced and atomically renamed. A separate exclusive lock serializes login/logout/refresh. Failed login leaves old credentials intact. An abandoned credential lock is never stolen: stop the owner before manual removal. A configured existing credential file is not automatically re-permissioned until replaced; provision imported files privately. State directory permissions remain the administrator's responsibility.

Verified session fingerprints map to stable UIDs for budgets, manual pauses and cursors. Drafts remain session-bound. Only verified old identities may migrate legacy state; conflicting/unmapped data stops login replacement. The identity mapping is saved before replacing credentials, so a failed replacement still leaves the previous login usable and migration is idempotent. State v1/v2 is backed up before migration to v3; old binaries reject v3. Stop all state users and preserve the latest state before a rollback. Never overwrite new send records with a pre-upgrade backup: that loses deduplication evidence. Logout removes local credentials and the refresh journal, retains state, and does not revoke remote sessions or interrupt captured in-flight requests.

## Approval and uncertain sends

Drafts bind content, target, account fingerprint and idempotency key. Approval binds the reviewed digest and expires with the draft after one hour. All write operations require the target allowlist and persistent store. Newly added actions also require an explicit `allowedActions` entry. File attachments are contained within the configured media root and bound by SHA256 at preparation; they are rechecked before execution. DM reads require trusted targets; sends also check mutual follows. A sending reservation is saved before dispatch. The safety guarantee concerns repeated execution with the same account and idempotency key; deliberately creating new keys or deleting state defeats deduplication.

If a request may have left the process but its outcome is not known, the draft remains `sending` or `unknown`. Never automatically retry it. A typed nonzero platform rejection is recorded as `rejected`; after reviewing the cause, an administrator may reapprove the same unexpired immutable draft. Completed upload steps are retained. Each step is journaled before dispatch; an interrupted pending step cannot automatically run again. A successfully acknowledged send is `sent`, which means Bilibili accepted the request, not a guarantee of visibility after moderation.

For a `sending`/`unknown` draft:

1. Stop the originating worker and ensure no request is still in flight. Preserve the draft and state.
2. Read the relevant conversation/comment/live history, or inspect it manually. Recent live history can be incomplete; absence alone is not proof that a message was not sent.
3. From a trusted administrator shell, reconcile only when the outcome is established:

```sh
node packages/cli/dist/main.mjs --config config.local.json admin.reconcile '{"draftId":"<id>","outcome":"sent"}'
```

Use `not-sent` only with evidence. That restores the same immutable draft to `draft` with a new one-hour expiry, clears approval and requires a fresh approval before execution. Only uncertain pending steps are cleared; successfully completed uploads remain recorded. Reconcile the final operation and its pending step from evidence, not from absence in a partial history list. Reconciliation is not available to MCP. Do not reconcile a live worker's `sending` operation.

After manually resolving a login/captcha problem, `admin.resume` with `{}` clears that account's manual pause. It does not clear risk backoff or budgets. A read-only operation can verify the account afterward. No command bypasses captcha or resets platform backoff.

## Verification scope

Regression tests use fixture credentials, injected fetch/clock and temporary directories. Tests cover protocol signing, endpoint fields, approval and account binding, persistent uncertain outcomes, concurrent reservations, rate limits, credential isolation, cursor replay/ack, CLI and MCP protocol. Package smoke tests install local tarballs and exercise built entrypoints. No real Bilibili account or external write is used by the test suite. Mock tests cannot establish current live API compatibility.

ffmpeg is optional and not bundled. File containment, size limits, attachment changes and CDN isolation have automated coverage. Set `BILI_TEST_FFMPEG` to enable actual local DASH merge, frame/contact-sheet and audio-decode tests; otherwise that test is explicitly skipped. Real decoding was also exercised on macOS arm64. ffmpeg receives local snapshots with restricted protocols, no shell and a bounded timeout; host operators remain responsible for the executable and decoding sandbox.

Open-platform signing, scopes, upload parts and retry behavior are tested against fixtures derived from official documentation. No authorized application was available for live submission verification. In particular, article GET form bodies follow the published documentation and still need application-level acceptance testing. Submission success is not final moderation approval.

## Reporting

For a security issue, use the repository's private vulnerability reporting if available, or contact the maintainer through the GitHub profile before publishing sensitive details. Do not include Cookies, private messages, credential files or state dumps in public issues.
