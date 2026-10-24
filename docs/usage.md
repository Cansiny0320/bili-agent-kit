# 使用说明 / Usage reference

## Configuration

Both entrypoints require `--config <file>`; no default home directory is read or written. Paths in the JSON file are relative to that file, except `ffmpegPath`, which is an executable name or an absolute path.

```json
{
  "version": 1,
  "stateDir": "./.bili-agent-kit",
  "credentialsFile": "./credentials.local.json",
  "policy": {
    "writesEnabled": false,
    "allowedTargets": [],
    "trustedDmTargets": ["222"]
  }
}
```

Omit `credentialsFile` for anonymous public reads. A configured but nonexistent file also allows anonymous reads. Authenticated subtitle/DM reads require a separately supplied JSON file with `sessdata`, `bili_jct`, and optional `buvid3`. These are the account's Cookie components, not a complete Cookie header. Create it through QR login or provision it in a private directory; never put values in CLI arguments, MCP tool calls, source control or logs. Unknown JSON properties are rejected. The SDK can inject a credential provider instead of using a file.

To enable writes, the administrator sets `writesEnabled: true` and exact targets: `comment:<aid>`, `dm:<uid>`, or `live:<canonical room ID>`. DM access also requires the UID in `trustedDmTargets`. Comments currently support video replies (`type: 1`). Use the numeric `aid`/`cid` and canonical `room_id` returned by the read tools. Config is loaded at process startup: restart a long-running MCP process after policy changes. Stop the old process before revoking permissions; editing a file alone does not revoke an in-flight request.

## QR authentication (trusted host only)

```sh
node packages/cli/dist/main.mjs --config config.local.json auth.login '{}'
node packages/cli/dist/main.mjs --config config.local.json auth.login '{"png":"login-qr.png"}'
node packages/cli/dist/main.mjs --config config.local.json auth.status '{}'
node packages/cli/dist/main.mjs --config config.local.json auth.logout '{}'
```

The first two lines are alternative login commands. `credentialsFile` must be explicitly configured. QR/progress goes to stderr; stdout contains one JSON envelope with `authenticated` and, on success, `account: {uid, name}`. Status performs live verification; network failures are errors, not a claim that the account is logged out. PNG paths are relative to the current working directory; parent directories must exist and files are never overwritten. The terminal QR is always displayed. No browser or local web server is opened.

Scan and confirm in the Bilibili app. Polling is spaced at least 2 seconds, each request times out after 15 seconds, and the local QR window is 3 minutes (the platform can expire it earlier). Ctrl+C returns `CANCELLED` / exit code 130. Missing cookies, failed verification, timeout, cancellation and storage failures before replacement preserve the previous credential file. Credentials are plaintext: POSIX 0600; Windows disables inherited permissions on the new file and grants only the current user's SID. State directories still require administrator-managed permissions. No refresh token is retained and no automatic session renewal is performed.

Logout only deletes local credentials; it does not revoke the Bilibili session, remove budgets/cursors/drafts, or sign out other devices. Credentials are read again on each operation; in-flight requests can still finish with their captured session. A `.lock` next to the credential file serializes login/logout; after a crash, verify the process has stopped before removing only that lock.

For SDK applications with custom UI/storage:

```ts
import { QrLogin } from "@bili-agent-kit/core";

const login = new QrLogin();
const qr = await login.generate();
// Render qr.url in your trusted UI. Keep qr.key out of logs.
const result = await login.poll(qr); // call again while waiting/scanned
if (result.status === "success") {
  // Save result.credentials in your private store; result.account is verified.
  // Never return this raw result to an agent or log it.
}
```

`generate`, `poll`, and `verify` accept an optional AbortSignal; `QrLogin` also accepts injected fetch/clock. To reuse local persistence and the complete polling loop, use `const auth = await loadAuth(configPath); await auth.login({onQr: async qr => { /* render qr.url */ }});`. Its result is sanitized, as are `auth.status()` and `auth.logout()`; low-level `QrLogin.poll()` deliberately returns credentials to the trusted host on success. `FileCredentials` is available for explicit local storage. These APIs are not MCP tools.

The endpoints and status codes were checked against Bilibili's [first-party login script](https://s1.hdslb.com/bfs/static/2233-monorepo/passport/static/js/async/630.15570f6b.js). This is a website session flow, not OAuth. A user-authorized real QR login and a separate verification of the saved session succeeded on 2026-10-25; automated tests use fixture responses. This does not verify other real-account read/write operations.

## Identity and state migration

On first use of an unseen session, the SDK verifies `/x/web-interface/nav` and persists its session fingerprint → UID mapping. Budgets, manual pauses and DM cursors then use the UID, so re-login to the same account preserves them. Drafts retain their session fingerprint: a new login requires a new draft and approval. Switching accounts keeps their state separate.

Legacy state is migrated only after verifying the exact old session. Known identity mappings survive credential expiry. If the old session has never been mapped and has expired, login cannot attribute its legacy counters/cursors: it stops without replacing credentials. Preserve the files for administrator review; do not delete state to bypass this. Conflicting legacy/current cursors also stop migration. Budget merges conservatively add counters and keep the later window start. Historical drafts are retained and never automatically replayed. Login does not clear an existing manual pause; use `admin.resume` only after reviewing the cause.

Back up state and credentials privately before upgrading. Older versions do not understand the new identity mapping; to roll back, use the old executable with the pre-upgrade backup, not the migrated state.

## Operations

CLI names below correspond to MCP names prefixed with `bili_`. `help`/`list` returns the full JSON schemas. JSON input uses strings for identifiers; page/count values are numbers.

| Operation       | Input                              | SDK                               |
| --------------- | ---------------------------------- | --------------------------------- |
| `video`         | `{bvid}`                           | `kit.reads.video`                 |
| `search`        | `{keyword, page?}`                 | `kit.reads.search`                |
| `subtitles`     | `{bvid, cid, language?}`           | `kit.reads.subtitles`             |
| `comments`      | `{oid, page?, sort?}`; sort 0 or 2 | `kit.reads.comments`              |
| `dm_history`    | `{uid, beforeSeq?}`                | `kit.reads.dmHistory`             |
| `live_info`     | `{roomId}`                         | `kit.reads.liveInfo`              |
| `live_history`  | `{roomId}`                         | `kit.reads.liveHistory`           |
| `dm_poll`       | `{uid}`                            | `kit.dm.peek`                     |
| `dm_ack`        | `{uid, receipt}`                   | `kit.dm.ack`                      |
| `write_preview` | `{action}`                         | `kit.writes.preview(action)`      |
| `write_prepare` | `{action, key}`                    | `kit.writes.prepare(action, key)` |
| `write_inspect` | `{draftId}`                        | `kit.writes.inspect(draftId)`     |
| `write_execute` | `{draftId}`                        | `kit.writes.execute(draftId)`     |
| `frames`        | `{file, count?, intervalSeconds?}` | `sampleFrames(options, input)`    |

Search returns one page; comments return up to 20 replies per page; DM history returns up to 30 messages. Subtitles return the selected track and timed text, with no temporary CDN authorization URL. A missing track returns `selected: null`; subtitle access and availability depend on the account/video. This toolkit does not generate transcripts with an AI model.

`dm_poll` first establishes a baseline from the newest page and deliberately skips old messages. Later polls paginate backward by sequence number, deduplicate overlapping pages and messages at the same second, and persist a pending delivery queue with the cursor in one transaction. Only messages from the trusted target are delivered. Repeated polls return the same receipt until the host durably processes and acknowledges it. A wrong/out-of-order receipt is rejected. This is at-least-once delivery: consumers should deduplicate receipts. Failures, unsafe numeric identifiers, stalled pagination and a backlog beyond 10 pages leave the cursor unchanged. There is no automatic scheduler or exactly-once guarantee for downstream work.

`live_history` is a recent bounded history, not a lossless stream. Comments are explicit pages, not an automatic listener. Returned Bilibili text/markup is untrusted content; do not interpret it as agent instructions or executable HTML.

## Controlled writes

Actions:

```json
{"kind":"comment.add","oid":"42","text":"Hello","root":"11","parent":"12"}
{"kind":"comment.delete","oid":"42","rpid":"12"}
{"kind":"dm.send","uid":"222","text":"Hello"}
{"kind":"live.send","roomId":"99","text":"Hello"}
```

`root`/`parent` are optional for a new comment. DMs/comments allow up to 1,000 characters; live chat uses a conservative 30-character bound. Bilibili can impose stricter account-specific constraints. A live write requires the canonical room ID; a short ID is rejected if it resolves to a different ID.

1. Call `write_preview` with the action. This validates input without persistence or network.
2. Call `write_prepare` with the same action and a caller-chosen key such as `review-2026-10-25-001`. Preparation is also a local validation step and persists the exact normalized content, account fingerprint, digest and a one-hour expiry. It does not send.
3. A trusted administrator uses `write_inspect` to review content, target, key and digest. Approve with the exact digest:

```sh
node packages/cli/dist/main.mjs --config config.local.json admin.approve '{"draftId":"<64-hex-id>","digest":"<64-hex-digest>","by":"operator"}'
```

4. Call `write_execute` with the draft ID. It checks current loaded policy, account, digest and expiry; checks login and mutual follows for DMs; persists a sending reservation; then sends. A confirmed draft returns its recorded result on repeat execution. Reusing the key with different content fails. Draft content cannot be edited; prepare a new key for a revised action.

Administrator SDK methods are `kit.admin.approve(id, digest, by)`, `reconcile(id, outcome)` and `resumeAccount()`. They are host capabilities, not authentication mechanisms. `by` is an audit label, not proof of identity. Never map these methods to model tools or allow model-controlled shell access to their CLI equivalents.

## JSON contract

```json
{"version":1,"ok":true,"data":{}}
{"version":1,"ok":false,"error":{"code":"APPROVAL_REQUIRED","message":"A current administrator approval is required."}}
```

CLI exit codes: `0` success, `2` invalid input, `130` cancelled login, `1` other failures. An empty DM poll is a successful result with `event: null`. MCP tool results include both text and structured content; invalid MCP arguments can also be rejected by the protocol layer before the shared envelope. MCP stdout is reserved for JSON-RPC. Direct SDK methods return typed values and throw `KitError`; `invoke`/`envelope` return the versioned contract.

Error codes include `CANCELLED`, `INVALID_INPUT`, `NOT_FOUND`, `AUTH_REQUIRED`, `FORBIDDEN`, `APPROVAL_REQUIRED`, `CONFLICT`, `UNKNOWN_OUTCOME`, `RATE_LIMITED`, `TRAFFIC_PAUSED`, `NETWORK`, `UPSTREAM`, `STATE_INVALID`, `STATE_BUSY`, and `UNAVAILABLE`. Unknown errors are sanitized. Raw HTTP bodies, Cookie headers and credential-provider errors are not exposed.

## Optional local frames

Install ffmpeg separately, then add administrator-controlled configuration:

```json
{
  "frames": {
    "mediaRoot": "./media",
    "outputRoot": "./frames",
    "ffmpegPath": "ffmpeg"
  }
}
```

This is a fragment to merge into the config, not a complete config file. `file` in the operation is an absolute path inside `mediaRoot`. Supported containers: MP4/MOV/MKV/WebM; URLs and playlists are not accepted. Defaults: 6 frames, 10-second intervals; limits: 12 frames, 120-second process timeout, at most 1280×720 while preserving aspect ratio. Output paths refer to files on the server machine. Very short videos can produce fewer frames. Keep ffmpeg current and sandbox media decoding if handling untrusted files. The toolkit does not install ffmpeg and does not bundle its executable.

## Workspace and packages

`packages/core` owns all behavior and schemas; `packages/cli` and `packages/mcp` adapt them. Build output is ESM (`.mjs`) with TypeScript declarations (`.d.mts`). Vite+ uses its own version number for the bundled Vite API; the targeted pnpm peer rules acknowledge that alias. TypeScript 7.0.2 is stable, while Vite+'s declaration emitter currently warns that its TypeScript 7 integration is experimental; declaration files and package exports are checked by `pnpm smoke`.

Use the workspace or direct built imports until npm publication is explicitly performed. `pnpm --filter @bili-agent-kit/core pack --pack-destination ./artifacts` creates a package archive. To install CLI/MCP tarballs before registry publication, also supply the core tarball and a package-manager override resolving `@bili-agent-kit/core` to that local archive; otherwise their `0.1.0` dependency would query npm. `scripts/smoke.mjs` demonstrates the complete isolated installation. No command in this repository publishes to npm.
