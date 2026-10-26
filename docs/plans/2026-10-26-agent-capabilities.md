# Agent 能力扩展实施计划

依据：../specs/2026-10-26-agent-capabilities.md（已批准）。

1. 基线与依赖：保留现有 client/media/reads/write-actions 及相关测试中的修改；记录检查基线。安装 FFmpeg、whisper.cpp、多语言模型。安装会写本机依赖目录并下载公开文件；单测不访问 B 站。
2. 目录与稍后再看：新增 collections.ts；reads.ts 复用；actions.ts/write-actions.ts 增加 watch_later.add/remove。新增独立测试，验证分页参数、账号审批和请求字段。
3. 时间素材与 ASR：frames.ts、media.ts、reads.ts 增加时间范围；新增 timeline.ts/asr.ts 复用 FFmpeg 和现有文件边界。runtime.ts 解析配置。测试范围裁剪、原时间轴、限制与真实本地媒体。
4. 增量与持久化：events.ts 增加 user_videos/collection/series；contracts.ts/state.ts 迁移新状态；新增完整扫描、旧视频新增、缺页不推进、并发及重放测试。
5. 官方管理：open-platform.ts 增加 ARC_DATA 与服务调用；新增 open-auth.ts 和 CLI 管理入口，原子私有凭据持久化；测试刷新、单次使用和错误脱敏。
6. 官方事件：新增 open-events.ts/open-live.ts，验签幂等队列与 WS 协议、心跳、重连。SDK 宿主管理，operations 只消费持久队列。使用模拟传输验证错误和关闭路径。
7. 文档与总验收：更新 usage/verification 和必要导出；运行定向测试、全量 test、check、build、smoke。check 无 --fix；build 写 dist；smoke 在临时目录 pack/install 并可能访问包 registry。最后检查任务差异和剩余真实授权限制。

通过条件：八项都有可调用实现和对应合同验证；新功能缺配置时给明确错误；现有行为不回归；不使用真实账号测试其他互动或投稿。

风险：非官方接口变化；真实模型精度有限；官方权限和回调/直播链路无法由本地模拟证明；共享目录可能有并发改动。

回滚：仅撤销本次明确修改，保留先前及其他会话改动；新状态降级须停止写入并恢复对应旧版备份，不能让旧进程覆盖新状态。依赖安装与模型文件独立，不自动卸载或删除现有依赖。

进度：全部实施完成。本机 pnpm 12.15.0 自动切换存在 ENOEXEC，使用 Node 24.19.0、可用 pnpm 10.28.0 和项目 runner 完成等价检查，未调整项目依赖或包管理器声明。

## 新增范围（已批准）

8. 在原阶段 2 后扩展 collections/read 合同与 actions/write-actions/writes：稍后再看分页/排序、收藏搜索、50 条视频的批量添加、收藏夹创建/编辑、跨夹复制/移动、移入收藏及相邻插入排序。新增 library-writes/read 测试，覆盖重复 ID、所有目标 allowlist、两边归属、编辑快照冲突、协议编码、部分回读失败及 unknown 不重发。SDK/CLI/MCP 保持同一实现。
9. 真实验证：先尊重现有登录状态的退避与写预算，建立专属临时私密收藏夹，验证后清理仅本次创建的夹和条目。记录 API 成功与回读证据，不把仅 code 0 当作全部条目已生效。不得修改既有收藏内容，不自动重试未知写入。

验收：32 个测试文件、119 项测试全部通过，包含真实 FFmpeg 与本地中文 ASR；格式、lint、TypeScript、三包构建、独立 pack/install 和 MCP stdio 检查通过。真实收藏/稍后再看操作完成回读并清理；官方 OAuth、创作数据、Webhook 和直播已通过协议模拟测试，缺应用授权，未做真实联调。完整范围和执行命令见 [验收记录](../verification.md)。
