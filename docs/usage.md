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

Omit `credentialsFile` for anonymous public reads. Authenticated subtitle/DM reads require a separately supplied JSON file with `sessdata`, `bili_jct`, and optional `buvid3`. These are the account's Cookie components, not a complete Cookie header. Provision the file yourself in a private directory; never put values in CLI arguments, MCP tool calls, source control or logs. Unknown JSON properties are rejected. The SDK can inject a credential provider instead of using a file.

To enable writes, the administrator sets `writesEnabled: true` and exact targets: `comment:<aid>`, `dm:<uid>`, or `live:<canonical room ID>`. DM access also requires the UID in `trustedDmTargets`. Comments currently support video replies (`type: 1`). Use the numeric `aid`/`cid` and canonical `room_id` returned by the read tools. Config is loaded at process startup: restart a long-running MCP process after policy changes. Stop the old process before revoking permissions; editing a file alone does not revoke an in-flight request.

## Operations

### Login integration status (2026-10-25)

This release accepts credentials from a trusted provider or an explicitly configured file; it does not implement QR login or OAuth. A host can provide a separate connection experience without exposing Cookies to the model.

[JiJiDown's official update history](https://client.jijidown.com/updates.html) documents QR login behavior and, in v2.0.39 (2026-05-31), encrypted Cookie storage in `bilibili.json`. This supports a client-session route, but does not establish OAuth use. Bilibili's [official account-authorization entry](https://open.bilibili.com/doc/4/eaf0e2b5-bde9-b9a0-9be1-019bb455701c) is listed in its [first-party documentation bundle](https://s1.hdslb.com/bfs/static/studio/arcopen-fe/js/Doc.f8fe9621.js). OAuth admission, scopes for comment/DM/live sending, and suitability for long-running cloud tasks remain unverified. Its linked [older server demo](https://github.com/bilibili-openplatform/demo) is archived and explicitly not recommended, so it is not used as an implementation basis.

A future QR connection flow should remain administrator-only, store the resulting session through a separate credential provider and retain all existing write approvals. Login success must never be presented as permission to perform every interaction. Such an extension needs a separately reviewed session-storage and refresh design; no QR session, account login or OAuth application was created during this work.

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

CLI exit codes: `0` success, `2` invalid input, `1` other failures. An empty DM poll is a successful result with `event: null`. MCP tool results include both text and structured content; invalid MCP arguments can also be rejected by the protocol layer before the shared envelope. MCP stdout is reserved for JSON-RPC. Direct SDK methods return typed values and throw `KitError`; `invoke`/`envelope` return the versioned contract.

Error codes include `INVALID_INPUT`, `NOT_FOUND`, `AUTH_REQUIRED`, `FORBIDDEN`, `APPROVAL_REQUIRED`, `CONFLICT`, `UNKNOWN_OUTCOME`, `RATE_LIMITED`, `TRAFFIC_PAUSED`, `NETWORK`, `UPSTREAM`, `STATE_INVALID`, `STATE_BUSY`, and `UNAVAILABLE`. Unknown errors are sanitized. Raw HTTP bodies, Cookie headers and credential-provider errors are not exposed.

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
