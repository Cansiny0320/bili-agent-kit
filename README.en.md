<h1 align="center">bili-agent-kit</h1>
<p align="center">Bilibili tools for AI assistants and applications.</p>
<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/TypeScript-SDK%20%7C%20CLI%20%7C%20MCP-3178c6" alt="TypeScript SDK, CLI and MCP">
  <a href="https://github.com/Cansiny0320/bili-agent-kit/actions/workflows/ci.yml"><img src="https://github.com/Cansiny0320/bili-agent-kit/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>
<p align="center">
  <a href="README.md">简体中文</a> · <a href="README.en.md">English</a> · <a href="https://github.com/Cansiny0320/bili-agent-kit/issues">Feedback</a>
</p>

bili-agent-kit provides a TypeScript SDK, command-line tools and an MCP server for reading Bilibili content, processing media, receiving events and performing approved interactions or submissions.

## What can it do?

- **Discover and read**: popular videos, rankings, search, users, uploads, favorites, history, watch later, dynamics, articles, comments, video danmaku and Bilibili AI summaries.
- **Receive events**: trusted DMs, replies, mentions, likes, comments and recent live chat, with persistent deduplication and receipt/ack delivery.
- **Process media**: resolve BV/AV/URLs and multipart videos, download video/audio, clip audio, sample frames and contact sheets, export subtitles/articles and return native MCP images.
- **Interact after review**: likes, favorites, follows, coins, triple actions, comments, DMs, video/live danmaku and text/image dynamic creation, editing and deletion.
- **Manage creator content**: read creator metrics and use independent official open-platform authorization for video/article queries, uploads, publishing, editing and deletion.
- **Manage sessions**: Bilibili-app QR login and explicit Cookie refresh through the trusted CLI/SDK.

See the [usage reference](docs/usage.md) for operation inputs, media directories and open-platform authorization.

## Quick start

Requires Node.js **22.18+, 24.11+ or 26+**. Node.js 23/25 are unsupported.

| Package                                                                    | Purpose                                              |
| -------------------------------------------------------------------------- | ---------------------------------------------------- |
| [@bili-agent-kit/core](https://www.npmjs.com/package/@bili-agent-kit/core) | SDK for TypeScript / JavaScript applications         |
| [@bili-agent-kit/cli](https://www.npmjs.com/package/@bili-agent-kit/cli)   | Command-line operations, QR login and administration |
| [@bili-agent-kit/mcp](https://www.npmjs.com/package/@bili-agent-kit/mcp)   | Connect agents through stdio MCP                     |

```sh
npx --yes @bili-agent-kit/cli@0.2.0 help
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
npx --yes @bili-agent-kit/cli@0.2.0 --config config.local.json video '{"bvid":"BV1xx411c7mD"}'
```

The CLI writes JSON only to stdout. Every response includes `version: 1` and `ok`; errors include a typed code and a nonzero exit status. Pass `-` to read JSON from stdin.

### QR login

The example config includes `credentialsFile`. Run these commands in a terminal you control:

```sh
npx --yes @bili-agent-kit/cli@0.2.0 --config config.local.json auth.login '{}'
npx --yes @bili-agent-kit/cli@0.2.0 --config config.local.json auth.status '{}'
```

Scan the QR printed to stderr with the Bilibili app and confirm on your phone. Use `'{"png":"login-qr.png"}'` to also create a PNG relative to the working directory; the path must not already exist. Login waits at most 3 minutes for scanning; Ctrl+C cancels. Failure preserves previous credentials.

The file is plaintext with restricted permissions and is replaced only after account verification. Logout removes only local credentials, preserving state and other devices' sessions. Login does not enable writes or clear platform backoff/manual pauses. An existing MCP process reads the shared credential file on its next operation.

Run this only when you want to log out:

```sh
npx --yes @bili-agent-kit/cli@0.2.0 --config config.local.json auth.logout '{}'
```

### Connect over MCP

Configure your AI assistant to run the npm package, replacing the config path with an actual absolute path. For authenticated access, first use the CLI commands above to log in with the same config:

```json
{
  "mcpServers": {
    "bilibili": {
      "command": "npx",
      "args": ["--yes", "@bili-agent-kit/mcp@0.2.0", "--config", "/absolute/path/config.local.json"]
    }
  }
}
```

Windows paths can use `D:/bilibili/config.local.json`. MCP and CLI `help` derive their complete operation lists from the same registry. Approval, policy changes, credential administration and account recovery are not exposed.

### Use the SDK

Install the SDK in your own project:

```sh
npm install @bili-agent-kit/core@0.2.0
```

Use ESM imports to read public video metadata:

```ts
import { BiliKit, FileStore } from "@bili-agent-kit/core";

const kit = new BiliKit({ store: new FileStore("./.bili-agent-kit") });
const video = await kit.reads.video({ bvid: "BV1xx411c7mD" });
console.log(video.title);
```

To reuse CLI/MCP configuration and login state, import `loadKit` from the same package and use `const kit = await loadKit("./config.local.json")`. Use `MemoryStore` for temporary reads. Sending requires saved drafts and execution records, so use `FileStore` or another persistent store. See the [usage reference](docs/usage.md) for the full API and configuration.

## Approvals and data

Sending starts with a saved draft. An administrator checks its content and digest before approving execution. A send request cannot be reused with different content. If the result is unclear, execution stops until someone checks what happened. DMs also require a trusted recipient and mutual following.

Cookies come from your configuration or SDK credential provider; the toolkit does not search your browser for them. Drafts and pending DMs are stored separately from cookies. Requests to subtitle CDNs do not include account cookies.

**MCP approval rules cannot stop an AI from running administrator commands through a terminal.** Restrict its access to those commands, credentials and state files separately. See [security and recovery](SECURITY.md) for permissions, rate limits and recovery steps.

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

`pnpm fmt` changes formatting. Tests use simulated network responses; set `BILI_TEST_FFMPEG` for real local decoding tests. `smoke` packages and installs all three packages, then checks the SDK, CLI and MCP server. The expanded APIs and writes have not completed live-account acceptance testing. Live chat tools read recent messages rather than listening continuously; your application must schedule repeated calls.

## License

[MIT licensed](LICENSE). See [NOTICE](NOTICE.md) for third-party component information. This project is not affiliated with Bilibili.

## Sponsorship

If this project is useful to you, you can support its continued development via WeChat Pay or Alipay. Thank you!

![Support via WeChat Pay or Alipay](.github/sponsorship/sponsorship-cats.png)

## Related projects

- [codex-bili-dragon](https://github.com/Cansiny0320/codex-bili-dragon): a Bilibili companion for the official Codex client, with video exploration, diaries and message handling.
- [dsh-bili-whale-dashboard](https://github.com/Cansiny0320/dsh-bili-whale-dashboard): a dashboard for the original DSH Bili Whale plugin, with diaries, reply reviews and personality settings.
