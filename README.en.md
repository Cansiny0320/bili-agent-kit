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

## Quick start

Requires Node.js **22.18+, 24.11+ or 26+**.

| Package                                                                    | Purpose                                         |
| -------------------------------------------------------------------------- | ----------------------------------------------- |
| [@bili-agent-kit/core](https://www.npmjs.com/package/@bili-agent-kit/core) | SDK for TypeScript / JavaScript applications    |
| [@bili-agent-kit/cli](https://www.npmjs.com/package/@bili-agent-kit/cli)   | Terminal and script access, login and approvals |
| [@bili-agent-kit/mcp](https://www.npmjs.com/package/@bili-agent-kit/mcp)   | Connect AI assistants through stdio MCP         |

### Command line

List the available commands, then try reading a video's metadata:

```sh
npx --yes @bili-agent-kit/cli@latest help
npx --yes @bili-agent-kit/cli@latest video '{"bvid":"BV1xx411c7mD"}'
```

### QR login

```sh
npx --yes @bili-agent-kit/cli@latest auth.login
npx --yes @bili-agent-kit/cli@latest auth.status
```

Scan the QR code with the Bilibili app and confirm on your phone.

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

Ask your assistant to log in to Bilibili, then scan and confirm with the Bilibili app.

### Use the SDK

Install the SDK in your own project:

```sh
npm install @bili-agent-kit/core
```

Read video metadata:

```ts
import { loadKit } from "@bili-agent-kit/core";

const kit = await loadKit();
const video = await kit.reads.video({ bvid: "BV1xx411c7mD" });
console.log(video.title);
```

## License

[MIT licensed](LICENSE). See [NOTICE](NOTICE.md) for third-party component information. This project is not affiliated with Bilibili.

## Sponsorship

If this project is useful to you, you can support its continued development via WeChat Pay or Alipay.

![Support via WeChat Pay or Alipay](.github/sponsorship/sponsorship-cats.png)

## Related projects

- [codex-bili-dragon](https://github.com/Cansiny0320/codex-bili-dragon): a Bilibili companion for the official Codex client, with video exploration, diaries and message handling.
- [dsh-bili-whale-dashboard](https://github.com/Cansiny0320/dsh-bili-whale-dashboard): a dashboard for the original DSH Bili Whale plugin, with diaries, reply reviews and personality settings.
