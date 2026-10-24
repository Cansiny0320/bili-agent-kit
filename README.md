<h1 align="center">bili-agent-kit</h1>
<p align="center">让任意 Agent 使用同一套 B 站工具。</p>
<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/TypeScript-SDK%20%7C%20CLI%20%7C%20MCP-3178c6" alt="TypeScript SDK, CLI and MCP">
  <a href="https://github.com/Cansiny0320/bili-agent-kit/actions/workflows/ci.yml"><img src="https://github.com/Cansiny0320/bili-agent-kit/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>
<p align="center">
  <a href="README.md">简体中文</a> · <a href="README.en.md">English</a> · <a href="https://github.com/Cansiny0320/bili-agent-kit/issues">问题反馈</a>
</p>

bili-agent-kit 是独立的 B 站工具库，提供 TypeScript SDK、JSON CLI 和 MCP。三种入口共用读取、审批、限流与发送逻辑，可以接入支持 MCP 的 Agent，也可以直接嵌入自己的程序。

直接基于 [dsh-bili-whale](https://github.com/Alterssss/dsh-bili-whale) v0.4.6 拆分；无需 Codex 登录、DSH 宿主或指定模型。

## 能做什么

- **读取内容**：视频信息、搜索结果、官方字幕、评论、可信对象的私信，以及直播房间和近期弹幕。
- **持续接收私信**：单次轮询、持久游标和收据确认，进程重启后仍可继续处理；轮询时间由宿主安排。
- **审核后发送**：评论发布与删除、私信、直播弹幕。写入默认关闭，须配置目标白名单并由管理员批准草稿。
- **提取画面**：可选 ffmpeg 从指定本地视频采样，最多 12 帧；不自动下载视频或安装 ffmpeg。

## 快速开始

需要 Node.js **22.18+、24.11+ 或 26+** 和 pnpm **12.15.0**。Node 23/25 不在支持范围。当前通过源码使用，尚未发布到 npm。

```sh
git clone https://github.com/Cansiny0320/bili-agent-kit.git
cd bili-agent-kit
pnpm install --frozen-lockfile
pnpm build
cp examples/config.json config.local.json
node packages/cli/dist/main.mjs help
```

读取视频信息：

```sh
node packages/cli/dist/main.mjs --config config.local.json video '{"bvid":"BV1xx411c7mD"}'
```

CLI 只向 stdout 输出 JSON。每个结果都有 `version: 1` 和 `ok`；失败时返回错误码并以非零状态退出。支持用 `-` 从 stdin 读取 JSON。

### 接入 MCP

在宿主的 MCP 配置中启动本地入口，替换成实际绝对路径：

```json
{
  "mcpServers": {
    "bilibili": {
      "command": "node",
      "args": [
        "/absolute/path/bili-agent-kit/packages/mcp/dist/main.mjs",
        "--config",
        "/absolute/path/bili-agent-kit/config.local.json"
      ]
    }
  }
}
```

Windows 路径可以使用 `D:/code/bili-agent-kit/...`。MCP 提供 14 个工具，不提供批准、策略修改、凭据管理或解除暂停工具。

### 使用 SDK

在工作区中引用 `@bili-agent-kit/core`，也可从构建后的 `packages/core/dist/index.mjs` 导入：

```ts
import { BiliKit, FileStore } from "@bili-agent-kit/core";

const kit = new BiliKit({ store: new FileStore("./.bili-agent-kit") });
const video = await kit.reads.video({ bvid: "BV1xx411c7mD" });
console.log(video.title);
```

凭据、状态存储、网络请求和时钟均可注入；只读临时会话可用 `MemoryStore`，外部写入要求持久存储。详细配置和全部操作见 [使用说明](docs/usage.md)。

## 审批与数据

写入流程为 **预览 → 持久草稿 → 管理员核对内容和摘要 → 执行**。相同幂等键不能换内容；发送结果不明时停止，必须由管理员回读核查。私信发送还要求可信目标和互相关注。

Cookie 只从显式配置或 SDK provider 取得，不扫描浏览器或用户主目录。状态保存在指定目录，含草稿和待处理私信，不含 Cookie；字幕 CDN 不接收账号 Cookie。

**CLI 管理命令不是 shell 沙箱。** 宿主必须把管理员命令、凭据和状态文件与模型的 shell/文件权限隔离。完整边界、限流和恢复方式见 [安全说明](SECURITY.md)。

## 开发与验证

```sh
pnpm check
pnpm test
pnpm build
pnpm smoke
```

`pnpm fmt` 会修改格式。测试使用模拟网络；`smoke` 打包三个包、独立安装并验证 SDK、CLI 和 MCP stdio。没有用真实账号发送消息。B 站接口可能变化，模拟测试不保证真实账号可用。直播读取为近期历史快照；当前没有常驻 WebSocket 监听或自动调度器。

## 来源与许可

使用 [MIT License](LICENSE)，保留原版作者 ALTERSSSS 的许可。原版提交、迁移对应关系和第三方说明见 [NOTICE](NOTICE.md)。本项目与 Bilibili 官方无关联。

## 赞助

如果这个项目对你有帮助，欢迎通过微信或支付宝支持后续开发。感谢你的支持！

![微信与支付宝赞助二维码](.github/sponsorship/sponsorship-cats.png)
