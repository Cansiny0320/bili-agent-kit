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

## What can it do?

- **Read content**: video metadata, search results, official subtitles, comments, trusted-target DMs, live room details and recent live chat.
- **Receive DMs reliably**: one-shot polling with persistent cursors and acknowledgement receipts survives process restarts. Your host controls scheduling.
- **Send after review**: add/delete comments, send DMs and live chat. Writes are disabled by default and require an allowlisted target and administrator-approved draft.
- **Sample frames**: optionally use your own ffmpeg to sample up to 12 frames from a configured local video. No automatic video downloads or ffmpeg installation.

## Quick start

Requires Node.js **22.18+, 24.11+ or 26+**. Node 23/25 are unsupported. All three packages are published on npm at **0.1.0**; no repository clone or pnpm installation is needed to use them.

| Package                                                                    | Purpose                                              |
| -------------------------------------------------------------------------- | ---------------------------------------------------- |
| [@bili-agent-kit/core](https://www.npmjs.com/package/@bili-agent-kit/core) | SDK for TypeScript / JavaScript applications         |
| [@bili-agent-kit/cli](https://www.npmjs.com/package/@bili-agent-kit/cli)   | Command-line operations, QR login and administration |
| [@bili-agent-kit/mcp](https://www.npmjs.com/package/@bili-agent-kit/mcp)   | Connect agents through stdio MCP                     |

```sh
npx --yes @bili-agent-kit/cli@0.1.0 help
```

Create `config.local.json` for both CLI and MCP:

```json
{
  "version": 1,
  "stateDir": "./.bili-agent-kit",
  "credentialsFile": "./credentials.local.json"
}
```

Paths in the config are relative to its directory. Writes are disabled by default; public content can be read anonymously when the credential file does not yet exist. See [examples/config.json](examples/config.json) for a full example.

Read a video's metadata:

```sh
npx --yes @bili-agent-kit/cli@0.1.0 --config config.local.json video '{"bvid":"BV1xx411c7mD"}'
```

The CLI writes JSON only to stdout. Every response includes `version: 1` and `ok`; errors include a typed code and a nonzero exit status. Pass `-` to read JSON from stdin.

### QR login

The example config includes `credentialsFile`. Run from a trusted administrator terminal:

```sh
npx --yes @bili-agent-kit/cli@0.1.0 --config config.local.json auth.login '{}'
npx --yes @bili-agent-kit/cli@0.1.0 --config config.local.json auth.status '{}'
```

Scan the QR printed to stderr with the Bilibili app and confirm on your phone. Use `'{"png":"login-qr.png"}'` to also create a PNG relative to the working directory; the path must not already exist. Login waits at most 3 minutes for scanning; Ctrl+C cancels. Failure preserves previous credentials.

The file is plaintext with restricted permissions and is replaced only after account verification. Logout removes only local credentials, preserving state and other devices' sessions. Login does not enable writes or clear platform backoff/manual pauses. An existing MCP process reads the shared credential file on its next operation.

Run this only when you want to log out:

```sh
npx --yes @bili-agent-kit/cli@0.1.0 --config config.local.json auth.logout '{}'
```

### Connect over MCP

Configure your host to run the npm package, replacing the config path with an actual absolute path. For authenticated access, first use the CLI commands above to log in with the same config:

```json
{
  "mcpServers": {
    "bilibili": {
      "command": "npx",
      "args": ["--yes", "@bili-agent-kit/mcp@0.1.0", "--config", "/absolute/path/config.local.json"]
    }
  }
}
```

Windows paths can use `D:/bilibili/config.local.json`. MCP exposes 14 tools. Approval, policy changes, credential administration and account recovery are not exposed.

### Use the SDK

Install the SDK in your own project:

```sh
npm install @bili-agent-kit/core@0.1.0
```

Use ESM imports to read public video metadata:

```ts
import { BiliKit, FileStore } from "@bili-agent-kit/core";

const kit = new BiliKit({ store: new FileStore("./.bili-agent-kit") });
const video = await kit.reads.video({ bvid: "BV1xx411c7mD" });
console.log(video.title);
```

To reuse CLI/MCP configuration and login state, import `loadKit` from the same package and use `const kit = await loadKit("./config.local.json")`. Credentials, storage, fetch and clock are injectable. `MemoryStore` supports temporary read sessions; external writes require durable storage. See the [usage reference](docs/usage.md) for configuration and operations.

## Approvals and data

Writes follow **preview → persistent draft → administrator reviews content and digest → execute**. An idempotency key cannot be reused with different content. Uncertain sends stop until an administrator reconciles the outcome. DMs additionally require a trusted target and a verified mutual follow.

Cookies come only from explicit configuration or an SDK provider. The toolkit does not inspect browsers or home directories. The state directory contains drafts and pending DMs, never account Cookies. Subtitle CDN requests do not carry account Cookies.

**CLI administration is not a shell sandbox.** The host must separate administrator commands, credentials and state files from model-controlled shell/file access. See [security and recovery](SECURITY.md).

## Development and verification

Source development requires pnpm **12.15.0**:

```sh
git clone https://github.com/Cansiny0320/bili-agent-kit.git
cd bili-agent-kit
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm smoke
```

After building, run `node packages/cli/dist/main.mjs help` to use the local CLI. Read and login operations still require an explicit config file.

`pnpm fmt` changes formatting. Tests use simulated network responses; `smoke` packs and independently installs all three packages, then checks SDK/CLI exports and MCP stdio. No real-account messages were sent. Bilibili interfaces may change; simulated tests do not establish live-account compatibility. Live chat reads are recent snapshots; persistent WebSocket listening and scheduling are not included.

## License

[MIT licensed](LICENSE). See [NOTICE](NOTICE.md) for third-party component information. This project is not affiliated with Bilibili.

## Sponsorship

If this project is useful to you, you can support its continued development via WeChat Pay or Alipay. Thank you!

![Support via WeChat Pay or Alipay](.github/sponsorship/sponsorship-cats.png)
