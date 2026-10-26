# Verification record

## 真实账号复测与修复（2026-10-26）

本次使用已有登录和共享请求状态验证本地修复版本，未发布新版本。

- 动态编辑：补齐 query 中的 CSRF，并在编辑前调用 `submit_check`。对照请求确认，省略内容检查时接口可能返回成功但正文为空；补齐后，最终代码在新测试动态上完成创建、编辑、正文回读和删除。请求格式同时对齐 `scene: 2`、空图片字段和 `platform` 签名参数。两条测试动态均已删除。
- 媒体：从接口返回的首选和备用地址中，先选择符合现有 CDN 校验规则的地址再下载。真实音频、视频下载和在线抽帧通过，得到 3 张 JPEG。HTTPS、域名和端口约束保持不变；收到风控响应后不切换地址重试。
- 普通写操作：按用户要求移除本地 120 秒冷却，已验证不同获批操作可以连续执行。私信的 60 秒冷却、请求间隔、账号预算和平台风控退避保持原有规则。
- 空间列表：`user_dynamics` 已补齐当前网页使用的 WBI、`platform` 和 `timezone_offset`，真实复测仍返回 HTTP 412，尚未解决。`user_videos` 之前也返回 412；本轮因共享退避未继续请求，未加入未经验证的兼容参数。

本次维护范围的 21 个测试文件共 87 项通过，包含真实 FFmpeg 解码；`pnpm build`、`pnpm smoke` 通过。完整 `pnpm check` 和 `pnpm test` 受到另一会话新增的 `tests/collections-watch-later.test.ts` 影响：该文件尚有格式问题及 4 项待实现测试，未修改这部分工作。本次改动文件的格式、lint 和类型检查通过；排除该待实现文件后的 TypeScript 检查通过。

动态协议另行核对了 B 站当前页面加载的[官方脚本](https://s1.hdslb.com/bfs/static/2233-monorepo/dyn-home/static/js/index.c648f6cd.js)：`uX` 先执行内容检查，仅成功后才调用 `uZ` 提交编辑；`u3`、`u9` 负责请求内容。此处为静态协议依据，实际行为以上述账号复测为准。测试凭据、账号标识、私信和完整响应未加入仓库。

Validated locally on 2026-10-25 with Windows, Node 24.19.0, pnpm 12.15.0, Vite+ 1.4.0 and TypeScript 7.0.2.

- `pnpm check`: formatting, Oxlint type-aware checks and TypeScript passed without warnings/errors.
- `pnpm test`: 47 tests passed across 12 files, using simulated requests and temporary state. Includes WBI signature fixtures, file-store concurrency/corruption, approval/digest/account binding, durable uncertain sends, endpoint forms, budgets/backoff, subtitle credential isolation, DM pagination/replay/ack, CLI, MCP, and ffmpeg invocation boundaries.
- `pnpm build`: all three ESM packages and declarations generated. The Vite+ declaration emitter reports its TypeScript 7 integration as experimental; compilation and separate consumer type checks passed.
- `pnpm smoke`: local tarballs installed independently, SDK/CLI/MCP exports and CLI JSON/exit codes passed; TypeScript consumer compiled against packaged declarations; built MCP stdio negotiated and called a tool; license notices included in each package.
- `pnpm peers check`: no peer dependency issues.

Automated tests use fixture credentials and do not send real Bilibili content. The separately authorized live QR login and subsequent auth.status verification succeeded; real content reads/writes and actual ffmpeg decoding remain unverified. No npm publication or hosted service deployment was performed; ffmpeg was not available on the local PATH, so invocation tests use a controlled process mock. CI repeats the workspace and package checks on Windows and Linux; see GitHub Actions for the current remote result.

The first remote Windows run exposed transient `EPERM` during concurrent exclusive lock creation and a short-path expectation in the frame test. A standalone Windows file-race reproduction observed `EPERM` alongside `EEXIST`; the store now retries creation within the existing deadline without stealing locks. A deterministic regression test covers preservation of existing state. The frame assertion compares the canonical path already used by the implementation.

## QR login addition (local, 2026-10-25)

The QR login change passed local validation. Remote CI results are tied to their Git revision and must be checked separately. The packages have not been published to npm.

- QR generation/poll/verification fixtures cover waiting, scanned, success, expiry, cancellation, bad responses, missing cookies, foreign QR origins, network errors and credential-echo redaction.
- Credential-file tests cover atomic replacement, failed-update preservation, concurrent update rejection, logout, invalid files and failed identity persistence. On Windows, an independent ACL inspection verified inheritance is disabled and only the current user's SID has an access rule.
- Identity tests cover legacy counters/pauses/cursors, idempotent migration, account isolation, conflicts without mutation, session-bound drafts, expired dispatch-lease recovery and concurrent legacy reservations. Same-account re-login does not clear shared budgets or cursors.
- CLI tests generate a fixture QR/PNG, preserve an existing PNG, reject unknown auth input and check sanitized output. The packaged CLI's auth.status command returns authenticated:false with a missing credential file. MCP still exposes only its original 14 public tools.
- `pnpm check` passes without warnings; all 47 tests pass. All three packages build and the independent pack/install/stdio smoke passes. The existing declaration-emitter experimental TypeScript 7 warning remains.

A user-authorized live follow-up requested real QR challenges. The current generation endpoint returns an HTTPS account.bilibili.com URL; the QR allowlist now accepts this exact origin alongside passport.bilibili.com. A regression fixture reproduced the original rejection and passes after the fix. Real QR generation, phone scanning/confirmation, successful Set-Cookie parsing and credential persistence all succeeded. A separate auth.status invocation loaded the saved credentials and verified authenticated:true against Bilibili. Account identifiers and credential values are intentionally omitted from this public record. No Bilibili content has been sent. File permissions were tested on Windows; POSIX permission checks are present but were not executed on this host.

The first QR-login CI run passed Linux but timed out in the Windows ACL observer test at 15 seconds; the other 46 tests passed. The observer now exports the native SDDL with bounded icacls/whoami subprocesses and checks the protected DACL plus the sole current-SID full-access entry directly. This removes the PowerShell/.NET inspection subprocess from the test without weakening the permission assertion or changing credential storage behavior.

The native observer then exposed token-default explicit SYSTEM/Administrators ACEs on the elevated Windows CI account. Removing inheritance alone does not remove explicit ACEs. Credential creation now resets the still-empty exclusive temporary file to inherited defaults before removing inheritance and granting only the current SID; data is written only afterward. The test still requires exactly one full-access ACE and accepts the equivalent SDDL `LA` alias when the current SID is the built-in local Administrator (RID 500). See [icacls reset/inheritance semantics](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls).
