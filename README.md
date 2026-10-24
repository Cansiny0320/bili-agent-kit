<h1 align="center">bili-agent-kit</h1>
<p align="center">给 AI 助手和应用接入 B 站工具。</p>
<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/TypeScript-SDK%20%7C%20CLI%20%7C%20MCP-3178c6" alt="TypeScript SDK, CLI and MCP">
  <a href="https://github.com/Cansiny0320/bili-agent-kit/actions/workflows/ci.yml"><img src="https://github.com/Cansiny0320/bili-agent-kit/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>
<p align="center">
  <a href="README.md">简体中文</a> · <a href="README.en.md">English</a> · <a href="https://github.com/Cansiny0320/bili-agent-kit/issues">问题反馈</a>
</p>

bili-agent-kit 提供 TypeScript SDK、命令行工具和 MCP 服务，用来读取 B 站视频、字幕、评论和消息，也支持扫码登录和审核后发送回复。可以接入支持 MCP 的 AI 助手，或在自己的程序中调用。

## 能做什么

- **读取内容**：视频信息、搜索结果、官方字幕、评论、可信对象的私信，以及直播房间和近期弹幕。
- **接收私信**：保存读取进度，重启后可以继续处理。需要定时检查时，由接入它的程序安排调用。
- **审核后发送**：评论发布与删除、私信、直播弹幕。写入默认关闭，须配置目标白名单并由管理员批准草稿。
- **提取画面**：可选 ffmpeg 从指定本地视频采样，最多 12 帧；不自动下载视频或安装 ffmpeg。

## 快速开始

需要 Node.js **22.18+、24.11+ 或 26+**，不支持 Node.js 23/25。

| 包                                                                         | 用途                                      |
| -------------------------------------------------------------------------- | ----------------------------------------- |
| [@bili-agent-kit/core](https://www.npmjs.com/package/@bili-agent-kit/core) | 在 TypeScript / JavaScript 程序中使用 SDK |
| [@bili-agent-kit/cli](https://www.npmjs.com/package/@bili-agent-kit/cli)   | 命令行调用、扫码登录和管理员操作          |
| [@bili-agent-kit/mcp](https://www.npmjs.com/package/@bili-agent-kit/mcp)   | 接入支持 stdio MCP 的 Agent               |

```sh
npx --yes @bili-agent-kit/cli@0.1.0 help
```

创建 `config.local.json`，供 CLI 和 MCP 共用：

```json
{
  "version": 1,
  "stateDir": "./.bili-agent-kit",
  "credentialsFile": "./credentials.local.json"
}
```

配置中的路径相对配置文件所在目录解析。写入默认关闭；凭据文件尚不存在时，可以匿名读取公开内容。完整配置示例见 [examples/config.json](examples/config.json)。

读取视频信息：

```sh
npx --yes @bili-agent-kit/cli@0.1.0 --config config.local.json video '{"bvid":"BV1xx411c7mD"}'
```

CLI 只向 stdout 输出 JSON。每个结果都有 `version: 1` 和 `ok`；失败时返回错误码并以非零状态退出。支持用 `-` 从 stdin 读取 JSON。

### 扫码登录

示例配置已指定 `credentialsFile`。在你自己控制的终端中运行：

```sh
npx --yes @bili-agent-kit/cli@0.1.0 --config config.local.json auth.login '{}'
npx --yes @bili-agent-kit/cli@0.1.0 --config config.local.json auth.status '{}'
```

二维码和进度显示在 stderr，用哔哩哔哩 App 扫码并在手机确认。需要图片时，将登录参数改为 `'{"png":"login-qr.png"}'`，路径相对当前工作目录，目标文件必须不存在。二维码最多等待 3 分钟，Ctrl+C 取消；失败保留旧凭据。

凭据以受限权限保存为本地明文 JSON，成功验证后才替换。退出仅删除这个本地文件，不撤销其他设备会话、不删除历史状态。登录不会开启发送权限或解除风控暂停。已有 MCP 进程会在下一次操作时读取同一文件。

需要退出时再运行：

```sh
npx --yes @bili-agent-kit/cli@0.1.0 --config config.local.json auth.logout '{}'
```

### 接入 MCP

在 AI 助手的 MCP 配置中使用 npm 包，将配置文件路径替换成实际绝对路径。需要登录时，先用上面的 CLI 命令对同一份配置扫码登录：

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

Windows 路径可以使用 `D:/bilibili/config.local.json`。MCP 提供 14 个工具，不提供批准、策略修改、凭据管理或解除暂停工具。

### 使用 SDK

在自己的项目中安装 SDK：

```sh
npm install @bili-agent-kit/core@0.1.0
```

使用 ESM 导入，读取公开视频信息：

```ts
import { BiliKit, FileStore } from "@bili-agent-kit/core";

const kit = new BiliKit({ store: new FileStore("./.bili-agent-kit") });
const video = await kit.reads.video({ bvid: "BV1xx411c7mD" });
console.log(video.title);
```

如需复用 CLI/MCP 的配置和登录状态，从同一包导入 `loadKit`，使用 `const kit = await loadKit("./config.local.json")`。临时读取可以使用 `MemoryStore`；发送操作需要保存草稿和执行记录，请使用 `FileStore` 等持久存储。完整 API 和配置见 [使用说明](docs/usage.md)。

## 审批与数据

发送前先生成并保存草稿，由管理员检查内容和摘要后批准执行。同一次发送不能通过更换内容重复执行；发送结果不明时会停止，需要先核查结果。私信还要求目标在可信名单中，且双方互相关注。

Cookie 由你指定的配置或 SDK 凭据提供器读取，不会自动扫描浏览器。草稿和待处理私信保存在配置的状态目录中，Cookie 单独保存；获取字幕时不会把 Cookie 发给字幕 CDN。

**MCP 中的审批限制不能阻止 AI 通过终端执行管理员命令。** 接入时，请单独限制 AI 对管理员命令、凭据和状态文件的访问。权限、限流和异常恢复见 [安全说明](SECURITY.md)。

## 开发与验证

从源码开发需要 pnpm **12.15.0**：

```sh
git clone https://github.com/Cansiny0320/bili-agent-kit.git
cd bili-agent-kit
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm smoke
```

构建后可用 `node packages/cli/dist/main.mjs help` 调用本地 CLI；读取或登录时仍需显式传入配置文件。

`pnpm fmt` 会修改格式。测试使用模拟网络；`smoke` 会打包并安装三个包，检查 SDK、CLI 和 MCP 是否能正常使用。尚未验证真实账号发送消息。直播工具读取近期弹幕记录，不会持续监听；定时调用需要由接入的程序安排。

## 许可

使用 [MIT License](LICENSE)，第三方组件说明见 [NOTICE](NOTICE.md)。本项目与 Bilibili 官方无关联。

## 赞助

如果这个项目对你有帮助，欢迎通过微信或支付宝支持后续开发。感谢你的支持！

![微信与支付宝赞助二维码](.github/sponsorship/sponsorship-cats.png)

## 相关项目

- [codex-bili-dragon](https://github.com/Cansiny0320/codex-bili-dragon)：在官方 Codex 客户端中运行的 B 站小白龙，按兴趣探索视频、写日记和处理消息。
- [dsh-bili-whale-dashboard](https://github.com/Cansiny0320/dsh-bili-whale-dashboard)：给 DSH 原版养鱼插件配套的管理后台，用来查看日记、审核回复和调整人设。
