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

<table>
  <thead>
    <tr><th width="100%" align="left">能力</th><th>MCP</th><th>CLI</th><th>SDK</th></tr>
  </thead>
  <tbody>
    <tr><td>视频搜索、热门排行、UP 投稿、合集与系列</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>字幕、评论、弹幕、动态与专栏读取</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>音视频下载、裁剪、定点抽帧与拼图</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>本地 ASR 转写、字幕与文章导出</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>收藏夹与稍后再看管理</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>私信、通知、评论与投稿增量事件</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>点赞、投币、三连、关注、评论、私信与弹幕发送</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>文字与图文动态发布、编辑、删除</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>官方创作数据、视频与文章投稿管理</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>官方 Webhook 与直播事件消费</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>扫码登录</td><td align="center">✓</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>Cookie/OAuth 管理与操作审批</td><td align="center">—</td><td align="center">✓</td><td align="center">✓</td></tr>
    <tr><td>官方 Webhook 接收与直播连接</td><td align="center">—</td><td align="center">—</td><td align="center">✓</td></tr>
  </tbody>
</table>

详细参数见 [使用说明](docs/usage.md)，版本变化见 [更新记录](CHANGELOG.md)。

## 快速开始

需要 Node.js **22.18+、24.11+ 或 26+**。

| 包                                                                         | 用途                                      |
| -------------------------------------------------------------------------- | ----------------------------------------- |
| [@bili-agent-kit/core](https://www.npmjs.com/package/@bili-agent-kit/core) | 在 TypeScript / JavaScript 程序中使用 SDK |
| [@bili-agent-kit/cli](https://www.npmjs.com/package/@bili-agent-kit/cli)   | 在终端或脚本中调用，管理登录和操作确认    |
| [@bili-agent-kit/mcp](https://www.npmjs.com/package/@bili-agent-kit/mcp)   | 接入支持 stdio MCP 的 AI 助手             |

### 命令行

查看可用命令，再试着读取视频信息：

```sh
npx --yes @bili-agent-kit/cli@latest help
npx --yes @bili-agent-kit/cli@latest video '{"bvid":"BV1xx411c7mD"}'
```

### 扫码登录

```sh
npx --yes @bili-agent-kit/cli@latest auth.login
npx --yes @bili-agent-kit/cli@latest auth.status
```

用哔哩哔哩 App 扫码并在手机上确认。

### 接入 MCP

把下面的配置加入 AI 助手：

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

接入后，对助手说“登录 B 站”，用哔哩哔哩 App 扫码确认即可。

### 使用 SDK

在自己的项目中安装 SDK：

```sh
npm install @bili-agent-kit/core
```

读取视频信息：

```ts
import { loadKit } from "@bili-agent-kit/core";

const kit = await loadKit();
const video = await kit.reads.video({ bvid: "BV1xx411c7mD" });
console.log(video.title);
```

## 许可

使用 [MIT License](LICENSE)，第三方组件说明见 [NOTICE](NOTICE.md)。本项目与 Bilibili 官方无关联。

## 赞助

如果这个项目对你有帮助，欢迎通过微信或支付宝支持后续开发。

![微信与支付宝赞助二维码](.github/sponsorship/sponsorship-cats.png)

## 相关项目

- [codex-bili-dragon](https://github.com/Cansiny0320/codex-bili-dragon)：在官方 Codex 客户端中运行的 B 站小白龙，按兴趣探索视频、写日记和处理消息。
- [dsh-bili-whale-dashboard](https://github.com/Cansiny0320/dsh-bili-whale-dashboard)：给 DSH 原版养鱼插件配套的管理后台，用来查看日记、审核回复和调整人设。
