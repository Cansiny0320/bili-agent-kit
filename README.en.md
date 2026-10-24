<h1 align="center">bili-agent-kit</h1>
<p align="center">One set of Bilibili tools for any agent.</p>
<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/TypeScript-SDK%20%7C%20CLI%20%7C%20MCP-3178c6" alt="TypeScript SDK, CLI and MCP">
  <a href="https://github.com/Cansiny0320/bili-agent-kit/actions/workflows/ci.yml"><img src="https://github.com/Cansiny0320/bili-agent-kit/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>
<p align="center">
  <a href="README.md">简体中文</a> · <a href="README.en.md">English</a> · <a href="https://github.com/Cansiny0320/bili-agent-kit/issues">Feedback</a>
</p>

bili-agent-kit is an independent Bilibili toolkit with a TypeScript SDK, JSON CLI and MCP server. All three share the same reads, approvals, rate limits and write execution. Connect it to an MCP host or embed it in your own application.

Adapted directly from [dsh-bili-whale](https://github.com/Alterssss/dsh-bili-whale) v0.4.6. No Codex login, DSH host or particular model is required.

## What can it do?

- **Read content**: video metadata, search results, official subtitles, comments, trusted-target DMs, live room details and recent live chat.
- **Receive DMs reliably**: one-shot polling with persistent cursors and acknowledgement receipts survives process restarts. Your host controls scheduling.
- **Send after review**: add/delete comments, send DMs and live chat. Writes are disabled by default and require an allowlisted target and administrator-approved draft.
- **Sample frames**: optionally use your own ffmpeg to sample up to 12 frames from a configured local video. No automatic video downloads or ffmpeg installation.

## Quick start

Requires Node.js **22.18+, 24.11+ or 26+** and pnpm **12.15.0**. Node 23/25 are unsupported. Use the source workspace for now; packages are not published to npm.

```sh
git clone https://github.com/Cansiny0320/bili-agent-kit.git
cd bili-agent-kit
pnpm install --frozen-lockfile
pnpm build
cp examples/config.json config.local.json
node packages/cli/dist/main.mjs help
```

Read a video's metadata:

```sh
node packages/cli/dist/main.mjs --config config.local.json video '{"bvid":"BV1xx411c7mD"}'
```

The CLI writes JSON only to stdout. Every response includes `version: 1` and `ok`; errors include a typed code and a nonzero exit status. Pass `-` to read JSON from stdin.

### Connect over MCP

Configure your host to launch the local entrypoint, replacing the absolute paths:

```json
{
  "mcpServers": {
    "bilibili": {
      "command": "node",
      "args": [
        "/absolute/path/bili-agent-kit/packages/mcp/dist/main.mjs",
        "--config",
        "/absolute/path/bili-agent-kit/config.local.json"
      ]
    }
  }
}
```

Windows paths can use `D:/code/bili-agent-kit/...`. MCP exposes 14 tools. Approval, policy changes, credential administration and account recovery are not exposed.

### Use the SDK

Reference `@bili-agent-kit/core` inside the workspace, or import the built `packages/core/dist/index.mjs` directly:

```ts
import { BiliKit, FileStore } from "@bili-agent-kit/core";

const kit = new BiliKit({ store: new FileStore("./.bili-agent-kit") });
const video = await kit.reads.video({ bvid: "BV1xx411c7mD" });
console.log(video.title);
```

Credentials, storage, fetch and clock are injectable. `MemoryStore` supports temporary read sessions; external writes require durable storage. See the [usage reference](docs/usage.md) for configuration and operations.

## Approvals and data

Writes follow **preview → persistent draft → administrator reviews content and digest → execute**. An idempotency key cannot be reused with different content. Uncertain sends stop until an administrator reconciles the outcome. DMs additionally require a trusted target and a verified mutual follow.

Cookies come only from explicit configuration or an SDK provider. The toolkit does not inspect browsers or home directories. The state directory contains drafts and pending DMs, never account Cookies. Subtitle CDN requests do not carry account Cookies.

**CLI administration is not a shell sandbox.** The host must separate administrator commands, credentials and state files from model-controlled shell/file access. See [security and recovery](SECURITY.md).

## Development and verification

```sh
pnpm check
pnpm test
pnpm build
pnpm smoke
```

`pnpm fmt` changes formatting. Tests use simulated network responses; `smoke` packs and independently installs all three packages, then checks SDK/CLI exports and MCP stdio. No real-account messages were sent. Bilibili interfaces may change; simulated tests do not establish live-account compatibility. Live chat reads are recent snapshots; persistent WebSocket listening and scheduling are not included.

## Source and license

[MIT licensed](LICENSE), retaining ALTERSSSS's original license. See [NOTICE](NOTICE.md) for the upstream commit, source mapping and third-party information. This project is not affiliated with Bilibili.

## Sponsorship

If this project is useful to you, you can support its continued development via WeChat Pay or Alipay. Thank you!

![Support via WeChat Pay or Alipay](.github/sponsorship/sponsorship-cats.png)
