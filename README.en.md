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

<table>
  <thead>
    <tr><th width="100%" align="left">Capability</th><th>MCP</th><th>CLI</th><th>SDK</th></tr>
  </thead>
  <tbody>
    <tr><td>Video search, rankings, creator uploads, collections and series</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>Subtitles, comments, danmaku, posts and articles</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>Media downloads, trimming, timestamped frames and contact sheets</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>Local ASR, subtitle and article export</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>Favorite folders and watch later</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>DMs, notifications, comments and new-upload events</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>Likes, coins, triple actions, follows, comments, DMs and danmaku</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>Text and image post creation, editing and deletion</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>Official creator data, video and article submissions</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>Official Webhook and live event consumption</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>QR login</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>Cookie/OAuth management and action approval</td><td align="center">—</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>Official Webhook ingestion and live connections</td><td align="center">—</td><td align="center">—</td><td align="center">✓</td></tr>
  </tbody>
</table>

See the [usage reference](docs/usage.md) for parameters and the [changelog](CHANGELOG.md) for version history.

Writes require approval, and media processing requires the corresponding dependencies. Official integrations require application authorization and have only passed protocol fixture tests; see the [verification record](docs/verification.md) for coverage.

## Quick start

Requires Node.js **22.18+, 24.11+ or 26+**. Node.js 23/25 are unsupported.

Automatic configuration and MCP QR login are not yet published to npm; [build from source](docs/usage.md#开发与验证) to use them. npm `0.3.0` still requires an explicit config.

| Package                                                                    | Purpose                                         |
| -------------------------------------------------------------------------- | ----------------------------------------------- |
| [@bili-agent-kit/core](https://www.npmjs.com/package/@bili-agent-kit/core) | SDK for TypeScript / JavaScript applications    |
| [@bili-agent-kit/cli](https://www.npmjs.com/package/@bili-agent-kit/cli)   | Terminal and script access, login and approvals |
| [@bili-agent-kit/mcp](https://www.npmjs.com/package/@bili-agent-kit/mcp)   | Connect AI assistants through stdio MCP         |

CLI and MCP automatically share configuration and login state under `~/.bili-agent-kit/`. Public reads work without login; writes are disabled by default. Use `--config <file>` for an existing or custom configuration; see the [usage reference](docs/usage.md#配置).

### Command line

List the available commands, then try reading a video's metadata:

```sh
npx --yes @bili-agent-kit/cli@latest help
npx --yes @bili-agent-kit/cli@latest video '{"bvid":"BV1xx411c7mD"}'
```

The CLI returns JSON for use in scripts.

### QR login

To read account content or interact with others, first log in from your terminal:

```sh
npx --yes @bili-agent-kit/cli@latest auth.login
npx --yes @bili-agent-kit/cli@latest auth.status
```

Scan the QR code with the Bilibili app and confirm on your phone. Credentials are saved to `~/.bili-agent-kit/credentials.json` and shared with MCP. An existing valid login is reused.

See the [login guide](docs/usage.md#扫码登录与刷新) to save the QR code as an image, refresh cookies or log out.

### Connect over MCP

Add this to your AI assistant's MCP configuration:

```json
{
  "mcpServers": {
    "bilibili": {
      "command": "npx",
      "args": ["--yes", "@bili-agent-kit/mcp@latest"]
    }
  }
}
```

Ask your assistant to log in to Bilibili: `bili_auth_login` returns a QR image, `bili_auth_status` checks progress, and `bili_auth_cancel` cancels the pending login. Confirm the scan in the Bilibili app. No separate CLI login is needed.

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

To share CLI/MCP configuration and login state, import `loadKit` from the same package and call `await loadKit()`. See the [usage reference](docs/usage.md) for the full API.

## License

[MIT licensed](LICENSE). See [NOTICE](NOTICE.md) for third-party component information. This project is not affiliated with Bilibili.

## Sponsorship

If this project is useful to you, you can support its continued development via WeChat Pay or Alipay.

![Support via WeChat Pay or Alipay](.github/sponsorship/sponsorship-cats.png)

## Related projects

- [codex-bili-dragon](https://github.com/Cansiny0320/codex-bili-dragon): a Bilibili companion for the official Codex client, with video exploration, diaries and message handling.
- [dsh-bili-whale-dashboard](https://github.com/Cansiny0320/dsh-bili-whale-dashboard): a dashboard for the original DSH Bili Whale plugin, with diaries, reply reviews and personality settings.
