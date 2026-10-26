<h1 align="center">bili-agent-kit</h1>
<p align="center">Bilibili tools for AI assistants and applications.</p>
<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/TypeScript-SDK%20%7C%20CLI%20%7C%20MCP-3178c6" alt="TypeScript SDK, CLI and MCP">
  <a href="https://github.com/Cansiny0320/bili-agent-kit/releases"><img src="https://img.shields.io/github/v/release/Cansiny0320/bili-agent-kit" alt="Latest release"></a>
</p>
<p align="center">
  <a href="README.md">简体中文</a> · <a href="README.en.md">English</a> · <a href="https://github.com/Cansiny0320/bili-agent-kit/issues">Feedback</a>
</p>

bili-agent-kit lets AI assistants and your own applications use Bilibili: search videos, read subtitles and comments, download video or audio, handle messages, and like, reply or publish after your approval.

Choose an MCP server, command-line tool or TypeScript SDK to fit your setup.

## What can it do?

- **Find content**: search videos and browse popular videos, rankings, creators' uploads, favorites, history, posts, articles, comments, danmaku and Bilibili AI summaries.
- **Work with video and audio**: resolve BV/AV IDs, links and multipart videos; download video or audio, trim audio, extract frames, make contact sheets, and export subtitles and articles.
- **Read messages**: fetch DMs, replies, mentions, like notifications, comments and recent live chat, with saved progress to reduce duplicate processing.
- **Interact and post**: like, favorite, follow, send coins, use triple actions, reply to comments, send DMs or danmaku, and create, edit or delete text and image posts. Each action needs approval.
- **Manage submissions**: view creator statistics and upload, publish, edit or delete videos and articles through Bilibili's official open platform. This requires separate application authorization.
- **Log in**: scan a QR code with the Bilibili app, then check your login status or refresh cookies through the CLI or SDK.

See the [usage reference](docs/usage.md) for parameters and the [changelog](CHANGELOG.md) for version history.

Video merging, audio trimming and frame extraction require a separate ffmpeg installation. Live chat tools fetch recent messages; your application must call them periodically. The APIs added in v0.2.0 have passed simulated tests but have not completed testing with a real account.

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
npx --yes @bili-agent-kit/cli@0.2.0 help
npx --yes @bili-agent-kit/cli@0.2.0 --config config.local.json video '{"bvid":"BV1xx411c7mD"}'
```

The CLI returns JSON for use in scripts.

### QR login

To read account content or interact with others, first log in from your terminal:

```sh
npx --yes @bili-agent-kit/cli@0.2.0 --config config.local.json auth.login '{}'
npx --yes @bili-agent-kit/cli@0.2.0 --config config.local.json auth.status '{}'
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
      "args": ["--yes", "@bili-agent-kit/mcp@0.2.0", "--config", "/absolute/path/config.local.json"]
    }
  }
}
```

On Windows, paths can use `D:/bilibili/config.local.json`.

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

To share CLI/MCP configuration and login state, import `loadKit` from the same package and call `await loadKit("./config.local.json")`. See the [usage reference](docs/usage.md) for the full API.

## Interactions, publishing and account data

Likes, replies, posts and submissions are disabled by default. Configure the allowed actions and targets before using them. Each action starts with a draft that you review and approve through the CLI or SDK. If the result is unclear, execution stops until you check what happened. DMs also require a trusted recipient and mutual following.

Login credentials are saved as plaintext in the local file you specify; the toolkit does not extract cookies from your browser. Drafts, message progress and upload records are saved in `stateDir`, separate from account credentials. Keep these files out of repositories and do not share them.

MCP does not expose approval tools. **An AI that can run administrator commands or modify credentials and state files can bypass these restrictions.** Restrict that access separately; see [security and recovery](SECURITY.md) for details.

## License

[MIT licensed](LICENSE). See [NOTICE](NOTICE.md) for third-party component information. This project is not affiliated with Bilibili.

## Sponsorship

If this project is useful to you, you can support its continued development via WeChat Pay or Alipay.

![Support via WeChat Pay or Alipay](.github/sponsorship/sponsorship-cats.png)

## Related projects

- [codex-bili-dragon](https://github.com/Cansiny0320/codex-bili-dragon): a Bilibili companion for the official Codex client, with video exploration, diaries and message handling.
- [dsh-bili-whale-dashboard](https://github.com/Cansiny0320/dsh-bili-whale-dashboard): a dashboard for the original DSH Bili Whale plugin, with diaries, reply reviews and personality settings.
