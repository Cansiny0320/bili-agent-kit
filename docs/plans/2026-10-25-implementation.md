# 实施计划

依照 `docs/specs/2026-10-25-bili-agent-kit.md` 在当前会话执行。

1. 建立 workspace：根 package.json、pnpm-workspace.yaml、tsconfig、vite.config.ts；三个独立包的 manifest/构建入口。验证 Node 和已安装类型；安装会生成 node_modules 与 lockfile。
2. 核心合同：`packages/core/src/{contracts,errors,state,wbi,traffic}.ts`；先建立 WBI、持久状态/限流测试，再实现。验证损坏状态、跨实例原子事务、风控暂停和请求间隔。
3. 协议与能力：`client.ts`、`writes.ts`、`poll.ts`、`frames.ts`；测试接口参数映射、字幕 Cookie 隔离、严格输入、互关、审批摘要与账号绑定、幂等冲突、预留后崩溃/断网、游标和失败保持。安全关键失败先复现再修复。
4. 统一接口：`operations.ts` 定义公开操作，`runtime.ts` 显式文件配置；CLI 输出 envelope 并提供独立 admin 命令，MCP 仅注册公开操作。使用子进程及 MCP in-memory transport 验证；无桌面输入。
5. 文档和分发：中英 README 参考 Nexlet 的简明介绍/快速开始/赞助结构，沿用实际赞助图片；补充配置、操作、安全、来源和贡献文档，LICENSE/NOTICE 随每个包分发。CI 使用相同验证。
6. 验证与发布：`pnpm test`（仅模拟/临时文件）、`pnpm check`（只读静态检查）、`pnpm build`（写 dist）、`pnpm smoke`（打包临时目录/验证包入口）；`pnpm fmt` 为明确的格式修复。检查所有候选提交、无敏感文件后初始化 Git、提交并创建公开 GitHub 仓库，push 后核查远端 commit 与 CI。不要 npm publish。

## 执行记录

步骤 1–5 已完成；本地验证通过，详细命令和边界见 `docs/verification.md`。步骤 6 的公开仓库发布在本地验证后执行，远端结果以 GitHub commit 和 Actions 为准。凭据只读注入合同保持不变；补充的扫码/OAuth 调研已写入使用文档的状态说明，未启动真实登录或扩展认证实现。

## 风险与回滚

B 站未公开承诺这些接口稳定性，模拟测试不能证明真实账号可用；未进行真实写入验证须明示。文件锁限单机本地文件系统，失效锁由管理员核实进程后处理，不能以超时强抢锁。未知发送保留记录直至人工核查，不提供自动重试。回滚代码使用已知提交；状态备份须停机并保留未知发送/审批记录，不能通过还原旧状态消除幂等记录。所有源码改动限定当前新目录，不修改 sibling 仓库与全局环境。
