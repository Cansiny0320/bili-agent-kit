# B 站能力补全实施计划

对应 [已批准设计](../specs/2026-10-26-capability-completion.md)。按下列依赖顺序在当前会话执行。

## 1. 开发基线与兼容基础

检查运行时与锁文件，安装现有依赖，运行原有测试；记录既有失败。修改 contracts.ts/state.ts/traffic.ts/client.ts，增加显式能力开关、版本化状态、受限传输和公共解析 helper；保持旧操作合同。测试旧状态迁移、混合版本拒绝、预算和网络失败。

## 2. 读取能力

新增 core/src/reads.ts、references.ts、danmaku.ts，扩展 kit.ts、operations.ts、models.ts、index.ts。实现搜索发现、用户、个人内容、动态、文章、消息、视频与评论。新增 tests/reads.test.ts，覆盖真实协议路径、参数、分页、长 ID、字幕分 P 及不存在场景。

## 3. 增量事件

新增 core/src/events.ts 并扩展状态及操作定义。评论/通知与直播用独立账号/source 游标，receipt 重放与 ack；失败不推进。tests/events.test.ts 覆盖重启、并发、时间边界、分页失败与快照覆盖不足。

## 4. 写操作扩展

拆分 writes.ts 的协议细节到 write-actions.ts，增加互动、动态和媒体附件的审核合同；新增动作须单独启用，旧配置不自动获得新动作权限。多步操作记录步骤和结果。tests/extended-writes.test.ts 验证默认拒绝、批准内容绑定、不可重复消费动作、上传/发布失败恢复。

## 5. 媒体

新增 core/src/media.ts，复用 frames.ts 的受限 ffmpeg 调用，扩展配置和 MCP 图片返回。下载/音频/拼图/字幕/文章导出/直播关键帧/素材聚合。tests/media.test.ts 使用临时文件和受控响应验证媒体边界，适用时运行真实本地 ffmpeg 解码。

## 6. 登录刷新

新增 auth-refresh.ts，修改 auth.ts/auth-runtime.ts/credentials.ts 和 CLI auth.ts。刷新 token 只在可信宿主保存，原子写入与中断恢复，保持账号预算和暂停状态。tests/auth-refresh.test.ts 验证刷新阶段与失败保留。

## 7. 创作者与开放平台

新增 creator.ts/open-platform.ts，独立凭据和签名，稿件查询/分区/上传/提交/编辑/删除以及文章稿件管理，复用审批和多步恢复合同。tests/open-platform.test.ts 验证官方签名、分片顺序、权限缺失、错误码、重复发布保护。无授权应用时明确真实验收未执行。

## 8. 文档与三入口验收

更新 README、包说明、docs/usage.md、SECURITY.md、examples/config.json、scripts/smoke.mjs 及适配器测试；能力清单来源为同一 operations 定义。记录功能/模拟验证/真实验证边界。

命令：pnpm check（只读检查）、pnpm test（临时文件和模拟网络）、pnpm build（生成 dist）、pnpm smoke（临时打包/安装，可能下载 npm 依赖）。pnpm fmt 会修改文件，仅在实现完成后明确运行。

## 风险与回滚

非公开接口可能漂移，按当前来源核对并保留可诊断的类型化错误，不以空结果吞掉失败。媒体与上传使用显式上限。外部调用超时视结果不明，不能以回滚本地状态重复执行。

回滚代码前停止所有共享状态进程并备份最新状态；保留新产生的草稿/发送记录。旧程序遇到新版本状态必须拒绝读写，不以旧备份覆盖已发生的外部动作。无真实写入时可在备份后恢复原测试状态。Git 和发布操作不属于本计划。

## 执行记录

- 已完成 8 项实施步骤。SDK、CLI 和 MCP 共用 58 项公共操作；写入 schema 共 23 种动作。原有 14 项公共操作保持兼容。
- `pnpm check` 通过：格式、lint 和类型检查无错误或警告。
- `pnpm test` 通过：20 个测试文件、70 项测试；设置 `BILI_TEST_FFMPEG`，真实本地 DASH 合并、抽帧拼图和音频裁剪/解码测试已执行，没有跳过。
- `pnpm build` 和 `pnpm smoke` 通过：三个包完成构建、临时打包安装、SDK 类型消费、CLI JSON/退出码、MCP stdio 及完整工具注册校验。构建器仍提示其 TypeScript 7 声明生成集成属于 experimental，产物和声明验证通过。
- 验证环境为 macOS arm64、Node.js 24.19.0、pnpm 12.15.0；未修改包版本或锁文件。宿主原 pnpm 启动器异常，通过临时命令包装使用现有 pnpm 12.15.0，未修改全局配置。
- 新增接口使用协议 fixture 验证；未执行真实账号写入、开放平台投稿或线上验收。开放平台需要独立应用授权，文章 GET 表单 body 等协议仍需授权环境验收。
- 已更新中英文 README、包说明、使用文档、示例配置和安全恢复说明；状态 v2 迁移、上传恢复及发布范围均已说明。
- 未 commit、push、创建 PR、发布 npm 包或部署。

## 后续发布授权

用户随后要求配置当前仓库的 GitHub 身份并 push、发布新版本，同时要求参考 bilibili-video-summary-agent 增加自动发布 CI。发布版本为 0.2.0；新增 release.yml，复用现有两平台 CI，以 OIDC 发布三个包并创建 GitHub Release。原执行记录中的未提交/未发布状态对应实现完成时，后续以实际 GitHub/npm 结果为准。
