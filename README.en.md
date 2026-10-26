<h1 align="center">bili-agent-kit</h1>
<p align="center">Connect your Agent to Bilibili with MCP, CLI and SDK.</p>
<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/TypeScript-SDK%20%7C%20CLI%20%7C%20MCP-3178c6" alt="TypeScript SDK, CLI and MCP">
  <a href="https://github.com/Cansiny0320/bili-agent-kit/releases"><img src="https://img.shields.io/github/v/release/Cansiny0320/bili-agent-kit" alt="Latest release"></a>
</p>
<p align="center">
  <a href="README.md">简体中文</a> · <a href="README.en.md">English</a> · <a href="https://github.com/Cansiny0320/bili-agent-kit/issues">Feedback</a>
</p>

## Supported capabilities

| Capability                                                       | MCP | CLI | SDK |
| ---------------------------------------------------------------- | :-: | :-: | :-: |
| Video search, rankings, creator uploads, collections and series  |  ✓  |  ✓  |  ✓  |
| Subtitles, comments, danmaku, posts and articles                 |  ✓  |  ✓  |  ✓  |
| Media downloads, trimming, timestamped frames and contact sheets |  ✓  |  ✓  |  ✓  |
| Local ASR, subtitle and article export                           |  ✓  |  ✓  |  ✓  |
| Favorite folders and watch later                                 |  ✓  |  ✓  |  ✓  |
| DMs, notifications, comments and new-upload events               |  ✓  |  ✓  |  ✓  |
| Likes, coins, triple actions, follows, comments, DMs and danmaku |  ✓  |  ✓  |  ✓  |
| Text and image post creation, editing and deletion               |  ✓  |  ✓  |  ✓  |
| Official creator data, video and article submissions             |  ✓  |  ✓  |  ✓  |
| Official Webhook and live event consumption                      |  ✓  |  ✓  |  ✓  |
| QR login, Cookie/OAuth management and action approval            |  —  |  ✓  |  ✓  |
| Official Webhook ingestion and live connections                  |  —  |  —  |  ✓  |

See the [usage reference](docs/usage.md) for parameters and the [changelog](CHANGELOG.md) for version history.

Writes require approval, and media processing requires the corresponding dependencies. Official integrations require application authorization and have only passed protocol fixture tests; see the [verification record](docs/verification.md) for coverage.

## Quick start

Requires Node.js **22.18+, 24.11+ or 26+**. Node.js 23/25 are unsupported.

| Package                                                                    | Purpose                                         |
| -------------------------------------------------------------------------- | ----------------------------------------------- |
| [@bili-agent-kit/core](https://www.npmjs.com/package/@bili-agent-kit/core) | SDK for TypeScript / JavaScript applications    |
| [@bili-agent-kit/cli](https://www.npmjs.com/package/@bili-agent-kit/cli)   | Terminal and script access, login and approvals |
| [@bili-agent-kit/mcp](https://www.npmjs.com/package/@bili-agent-kit/mcp)   | Connect AI assistants through stdio MCP         |

Create `config.local.json` for both CLI and MCP:

```json
{
  "version": 1,
  "stateDir": "./.bili-agent-kit",
  "credentialsFile": "./credentials.local.json"
}
```

Paths are relative to the config file's directory. You can read public content without logging in. Actions such as liking or sending messages are disabled by default. See [examples/config.json](examples/config.json) for more options.

### Command line

List the available commands, then try reading a video's metadata:

```sh
npx --yes @bili-agent-kit/cli@latest help
npx --yes @bili-agent-kit/cli@latest --config config.local.json video '{"bvid":"BV1xx411c7mD"}'
```

The CLI returns JSON for use in scripts.

### QR login

To read account content or interact with others, first log in from your terminal:

```sh
npx --yes @bili-agent-kit/cli@latest --config config.local.json auth.login '{}'
npx --yes @bili-agent-kit/cli@latest --config config.local.json auth.status '{}'
```

Scan the QR code with the Bilibili app and confirm on your phone. Credentials are saved to `credentials.local.json`. The CLI and MCP server share the login when they use the same config.

See the [login guide](docs/usage.md#扫码登录与刷新) to save the QR code as an image, refresh cookies or log out.

### Connect over MCP

Add this to your AI assistant's MCP configuration and replace the config path with an absolute path on your computer. If login is needed, run the QR login command above first:

```json
{
  "mcpServers": {
    "bilibili": {
      "command": "npx",
      "args": [
        "--yes",
        "@bili-agent-kit/mcp@latest",
        "--config",
        "/absolute/path/config.local.json"
      ]
    }
  }
}
```

On Windows, paths can use `D:/bilibili/config.local.json`.

### Use the SDK

Install the SDK in your own project:

```sh
npm install @bili-agent-kit/core
```

Use ESM imports to read public video metadata:

```ts
import { BiliKit, FileStore } from "@bili-agent-kit/core";

const kit = new BiliKit({ store: new FileStore("./.bili-agent-kit") });
const video = await kit.reads.video({ bvid: "BV1xx411c7mD" });
console.log(video.title);
```

To share CLI/MCP configuration and login state, import `loadKit` from the same package and call `await loadKit("./config.local.json")`. See the [usage reference](docs/usage.md) for the full API.

## License

[MIT licensed](LICENSE). See [NOTICE](NOTICE.md) for third-party component information. This project is not affiliated with Bilibili.

## Sponsorship

If this project is useful to you, you can support its continued development via WeChat Pay or Alipay.

![Support via WeChat Pay or Alipay](.github/sponsorship/sponsorship-cats.png)

## Related projects

- [codex-bili-dragon](https://github.com/Cansiny0320/codex-bili-dragon): a Bilibili companion for the official Codex client, with video exploration, diaries and message handling.
- [dsh-bili-whale-dashboard](https://github.com/Cansiny0320/dsh-bili-whale-dashboard): a dashboard for the original DSH Bili Whale plugin, with diaries, reply reviews and personality settings.
