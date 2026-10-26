# 默认登录实施计划

对应 [已批准设计](../specs/2026-10-26-default-login.md)。开始实施时工作区无未提交改动。

1. **默认运行时与 CLI** — `packages/core/src/runtime.ts`、`index.ts`、`packages/cli/src/index.ts` 及对应测试。先验证缺失配置、并发创建、显式错误、可省略参数的失败测试，再实现共享路径解析与安全初始化。CLI help 不创建文件；原显式参数保持兼容。
2. **MCP 登录** — `packages/mcp/src/auth.ts`、`index.ts`、`main.ts`、`package.json` 与 lockfile、`tests/mcp-auth.test.ts`。复用 `FileAuth`，有界后台扫码、原生图片与脱敏状态；测试重复启动、已登录、取消、过期、失败、关闭释放和管理员工具隔离。
3. **文档和表格** — 中英文 README、`docs/usage.md`、`SECURITY.md`、包 README 与必要 smoke 断言。快速开始去手建配置，拆分登录与管理员支持矩阵；核对 GitHub 渲染规则并调整能力表宽度。
4. **交付验证** — 相关测试先红后绿；`vp check`、`tsc --noEmit`、全量 `vp test run`、三包 build、licenses 和 `scripts/smoke.mjs`。测试仅使用临时目录和 mock 网络；build/format 会生成或修改本地产物，smoke 在临时目录 pack/install 并读取 npm。

风险：默认路径与旧项目路径不同，不自动迁移；文档说明旧配置继续显式使用。回滚可撤销本次源文件修改，保留默认目录中的用户凭据；无状态 schema 升级。不得替换已发布 tag；发布动作按用户对应授权单独执行。

## 完成记录

四项已完成。默认配置、CLI 参数、MCP 生命周期和文档均已更新；全量 127 项测试及 check、TypeScript、三包构建通过。独立安装后的实际 stdio smoke 覆盖默认 CLI/MCP 账号共享与扫码时关闭释放锁。GitHub Markdown API 保留首列宽度属性，同样样式的浏览器预览在 838px/343px 下，中英文均铺满且无横向溢出。登录使用临时目录和模拟网络，未访问或迁移用户凭据。本次未发布 npm 新版本。
