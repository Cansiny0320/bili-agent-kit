<h1 align="center">bili-agent-kit</h1>
<p align="center">给你的 Agent 接入 B 站，支持 MCP、CLI、SDK。</p>
<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/TypeScript-SDK%20%7C%20CLI%20%7C%20MCP-3178c6" alt="TypeScript SDK, CLI and MCP">
  <a href="https://github.com/Cansiny0320/bili-agent-kit/releases"><img src="https://img.shields.io/github/v/release/Cansiny0320/bili-agent-kit" alt="Latest release"></a>
</p>
<p align="center">
  <a href="README.md">简体中文</a> · <a href="README.en.md">English</a> · <a href="https://github.com/Cansiny0320/bili-agent-kit/issues">问题反馈</a>
</p>

## 支持能力

| 能力                                         | MCP | CLI | SDK |
| -------------------------------------------- | :-: | :-: | :-: |
| 视频搜索、热门排行、UP 投稿、合集与系列      |  ✓  |  ✓  |  ✓  |
| 字幕、评论、弹幕、动态与专栏读取             |  ✓  |  ✓  |  ✓  |
| 音视频下载、裁剪、定点抽帧与拼图             |  ✓  |  ✓  |  ✓  |
| 本地 ASR 转写、字幕与文章导出                |  ✓  |  ✓  |  ✓  |
| 收藏夹与稍后再看管理                         |  ✓  |  ✓  |  ✓  |
| 私信、通知、评论与投稿增量事件               |  ✓  |  ✓  |  ✓  |
| 点赞、投币、三连、关注、评论、私信与弹幕发送 |  ✓  |  ✓  |  ✓  |
| 文字与图文动态发布、编辑、删除               |  ✓  |  ✓  |  ✓  |
| 官方创作数据、视频与文章投稿管理             |  ✓  |  ✓  |  ✓  |
| 官方 Webhook 与直播事件消费                  |  ✓  |  ✓  |  ✓  |
| 扫码登录、Cookie/OAuth 管理与操作审批        |  —  |  ✓  |  ✓  |
| 官方 Webhook 接收与直播连接                  |  —  |  —  |  ✓  |

详细参数见 [使用说明](docs/usage.md)，版本变化见 [更新记录](CHANGELOG.md)。

写操作需审批，媒体处理需安装相应依赖。官方能力需应用授权，当前仅完成协议模拟验证；具体范围见[验证记录](docs/verification.md)。

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
npx --yes @bili-agent-kit/cli@latest help
npx --yes @bili-agent-kit/cli@latest --config config.local.json video '{"bvid":"BV1xx411c7mD"}'
```

CLI 返回 JSON，方便在脚本中使用。

### 扫码登录

需要读取账号内容或执行互动时，先在终端登录：

```sh
npx --yes @bili-agent-kit/cli@latest --config config.local.json auth.login '{}'
npx --yes @bili-agent-kit/cli@latest --config config.local.json auth.status '{}'
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

Windows 路径可以写成 `D:/bilibili/config.local.json`。

### 使用 SDK

在自己的项目中安装 SDK：

```sh
npm install @bili-agent-kit/core
```

使用 ESM 导入，读取公开视频信息：

```ts
import { BiliKit, FileStore } from "@bili-agent-kit/core";

const kit = new BiliKit({ store: new FileStore("./.bili-agent-kit") });
const video = await kit.reads.video({ bvid: "BV1xx411c7mD" });
console.log(video.title);
```

如需共用 CLI/MCP 的配置和登录状态，从同一包导入 `loadKit`，调用 `await loadKit("./config.local.json")`。完整 API 见 [使用说明](docs/usage.md)。

## 许可

使用 [MIT License](LICENSE)，第三方组件说明见 [NOTICE](NOTICE.md)。本项目与 Bilibili 官方无关联。

## 赞助

如果这个项目对你有帮助，欢迎通过微信或支付宝支持后续开发。

![微信与支付宝赞助二维码](.github/sponsorship/sponsorship-cats.png)

## 相关项目

- [codex-bili-dragon](https://github.com/Cansiny0320/codex-bili-dragon)：在官方 Codex 客户端中运行的 B 站小白龙，按兴趣探索视频、写日记和处理消息。
- [dsh-bili-whale-dashboard](https://github.com/Cansiny0320/dsh-bili-whale-dashboard)：给 DSH 原版养鱼插件配套的管理后台，用来查看日记、审核回复和调整人设。
