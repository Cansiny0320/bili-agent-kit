<h1 align="center">bili-agent-kit</h1>
<p align="center">给 AI 助手和应用接入 B 站工具。</p>
<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/TypeScript-SDK%20%7C%20CLI%20%7C%20MCP-3178c6" alt="TypeScript SDK, CLI and MCP">
  <a href="https://github.com/Cansiny0320/bili-agent-kit/releases"><img src="https://img.shields.io/github/v/release/Cansiny0320/bili-agent-kit" alt="Latest release"></a>
</p>
<p align="center">
  <a href="README.md">简体中文</a> · <a href="README.en.md">English</a> · <a href="https://github.com/Cansiny0320/bili-agent-kit/issues">问题反馈</a>
</p>

bili-agent-kit 让 AI 助手和你的程序调用 B 站功能：搜索视频、读取字幕和评论、下载视频或音频、处理消息，也可以在你确认后点赞、回复或投稿。

支持 MCP、命令行和 TypeScript SDK，按你的使用方式选择即可。

## 能做什么

- **查内容**：搜索视频，查看热门、排行、UP 主投稿、收藏、历史、动态、专栏、评论、弹幕和 B 站 AI 总结。
- **处理视频和音频**：识别 BV、AV、视频链接和分 P，下载视频或音频，裁剪音频、截取画面、生成拼图，导出字幕和文章。
- **收消息**：读取私信、回复、@、点赞通知、评论和近期直播弹幕，保存处理进度，减少重复处理。
- **互动和发动态**：点赞、收藏、关注、投币、三连、回复评论、发私信和弹幕，发布、编辑或删除文字及图文动态。执行前需要确认。
- **管理稿件**：查看创作数据，通过 B 站官方开放平台上传、发布、编辑或删除视频和文章，需要单独的应用授权。
- **登录账号**：用哔哩哔哩 App 扫码登录，通过 CLI 或 SDK 查看登录状态、检查和刷新 Cookie。

详细参数见 [使用说明](docs/usage.md)，版本变化见 [更新记录](CHANGELOG.md)。

视频合并、音频裁剪和抽帧需要另行安装 ffmpeg。直播工具读取的是近期消息，需要由你的程序定期调用。v0.2.0 新增接口已通过模拟测试，尚未完成真实账号验收。

## 快速开始

需要 Node.js **22.18+、24.11+ 或 26+**，不支持 Node.js 23/25。

| 包                                                                         | 用途                                      |
| -------------------------------------------------------------------------- | ----------------------------------------- |
| [@bili-agent-kit/core](https://www.npmjs.com/package/@bili-agent-kit/core) | 在 TypeScript / JavaScript 程序中使用 SDK |
| [@bili-agent-kit/cli](https://www.npmjs.com/package/@bili-agent-kit/cli)   | 在终端或脚本中调用，管理登录和操作确认    |
| [@bili-agent-kit/mcp](https://www.npmjs.com/package/@bili-agent-kit/mcp)   | 接入支持 stdio MCP 的 AI 助手             |

创建 `config.local.json`，供 CLI 和 MCP 共用：

```json
{
  "version": 1,
  "stateDir": "./.bili-agent-kit",
  "credentialsFile": "./credentials.local.json"
}
```

路径相对配置文件所在目录。未登录时可以读取公开内容，点赞、发送消息等操作默认关闭。更多配置见 [examples/config.json](examples/config.json)。

### 命令行

查看可用命令，再试着读取视频信息：

```sh
npx --yes @bili-agent-kit/cli@0.2.0 help
npx --yes @bili-agent-kit/cli@0.2.0 --config config.local.json video '{"bvid":"BV1xx411c7mD"}'
```

CLI 返回 JSON，方便在脚本中使用。

### 扫码登录

需要读取账号内容或执行互动时，先在终端登录：

```sh
npx --yes @bili-agent-kit/cli@0.2.0 --config config.local.json auth.login '{}'
npx --yes @bili-agent-kit/cli@0.2.0 --config config.local.json auth.status '{}'
```

用哔哩哔哩 App 扫码，在手机上确认即可。登录信息会保存到 `credentials.local.json`，CLI 和 MCP 使用同一份配置就能共用登录状态。

保存二维码图片、刷新 Cookie 和退出登录的方法见 [登录说明](docs/usage.md#扫码登录与刷新)。

### 接入 MCP

把下面的配置加入 AI 助手，将配置文件路径替换成你电脑上的绝对路径。需要登录时，先运行上面的扫码登录命令：

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

Windows 路径可以写成 `D:/bilibili/config.local.json`。

### 使用 SDK

在自己的项目中安装 SDK：

```sh
npm install @bili-agent-kit/core@0.2.0
```

使用 ESM 导入，读取公开视频信息：

```ts
import { BiliKit, FileStore } from "@bili-agent-kit/core";

const kit = new BiliKit({ store: new FileStore("./.bili-agent-kit") });
const video = await kit.reads.video({ bvid: "BV1xx411c7mD" });
console.log(video.title);
```

如需共用 CLI/MCP 的配置和登录状态，从同一包导入 `loadKit`，调用 `await loadKit("./config.local.json")`。完整 API 见 [使用说明](docs/usage.md)。

## 互动、投稿和账号数据

点赞、回复、发动态和投稿等操作默认关闭。使用前需要配置允许的操作和目标；执行时先生成草稿，由你检查并通过 CLI 或 SDK 批准。发送结果不明时会停下来，核实后才能继续。私信还要求对方在可信名单中，且双方互相关注。

登录信息以明文保存在你指定的本地文件中，不会自动从浏览器提取 Cookie。草稿、消息处理进度和上传记录保存在 `stateDir`，账号凭据单独保存。不要把这些文件提交到仓库或发给别人。

MCP 不提供批准操作的工具。**如果 AI 还能运行管理员命令或修改凭据、状态文件，它就能绕过这些限制。** 接入时需要单独限制这些权限，具体见 [安全说明](SECURITY.md)。

## 许可

使用 [MIT License](LICENSE)，第三方组件说明见 [NOTICE](NOTICE.md)。本项目与 Bilibili 官方无关联。

## 赞助

如果这个项目对你有帮助，欢迎通过微信或支付宝支持后续开发。

![微信与支付宝赞助二维码](.github/sponsorship/sponsorship-cats.png)

## 相关项目

- [codex-bili-dragon](https://github.com/Cansiny0320/codex-bili-dragon)：在官方 Codex 客户端中运行的 B 站小白龙，按兴趣探索视频、写日记和处理消息。
- [dsh-bili-whale-dashboard](https://github.com/Cansiny0320/dsh-bili-whale-dashboard)：给 DSH 原版养鱼插件配套的管理后台，用来查看日记、审核回复和调整人设。
