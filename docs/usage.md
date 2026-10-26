# 使用说明

本页对应当前源码；默认配置和 MCP 扫码登录尚未包含在 npm `0.3.0` 中。CLI、MCP 和 SDK 共用 core 的操作定义。`help` / `list` 返回完整输入 schema，MCP 工具名为 CLI 名称加 `bili_` 前缀。所有 ID 使用字符串，页码和数量使用数字。

新增的合集、收藏管理、时间素材、ASR、增量事件和官方授权/推送见 [能力扩展说明](agent-capabilities.md)。

## 配置

CLI、MCP 和 `loadKit()` / `loadAuth()` 省略配置时，会在用户主目录自动创建 `~/.bili-agent-kit/config.json`，默认凭据为同目录 `credentials.json`，状态为 `state/`。不依赖启动时的工作目录，也不会导入已有项目配置或浏览器 Cookie。并发启动不会覆盖已有配置。

`--config <file>` 优先使用指定配置；文件缺失或无效时直接报错，不回退到另一个账号。已有项目登录继续传入原配置即可。Windows 默认目录为 `%USERPROFILE%\.bili-agent-kit`。以下为自定义配置示例；路径相对配置文件目录，`ffmpegPath` 可以是可执行文件名或绝对路径。

```json
{
  "version": 1,
  "stateDir": "./.bili-agent-kit",
  "credentialsFile": "./credentials.local.json",
  "policy": {
    "writesEnabled": false,
    "allowedActions": [],
    "allowedTargets": [],
    "trustedDmTargets": []
  }
}
```

省略 `credentialsFile` 或文件不存在时，可匿名读取公开内容。文件包含 `sessdata`、`bili_jct`，以及可选 `buvid3`、`refresh_token`；通过扫码登录创建，不要把值放在命令参数、日志或版本控制中。SDK 也可提供 `credentials` 回调。未知配置字段会被拒绝。

策略在启动时加载；修改后重启服务。配置变更不会中断已经发出的请求。新写操作必须同时配置 `writesEnabled`、`allowedActions` 和目标白名单；旧评论、私信和直播发送保持原有合同。

## 扫码登录与刷新

在可信管理员终端运行：

```sh
node packages/cli/dist/main.mjs auth.login
node packages/cli/dist/main.mjs auth.status
node packages/cli/dist/main.mjs auth.refresh-check
node packages/cli/dist/main.mjs auth.refresh
```

有效登录会直接返回当前账号；更换账号须先用 CLI `auth.logout` 退出。需要扫码时，使用哔哩哔哩 App 扫码并确认。二维码和进度输出到 stderr，stdout 只包含 JSON。登录参数 `{"png":"login-qr.png"}` 可额外保存图片，文件不能已存在。扫码最多等待 3 分钟，每次轮询至少间隔 2 秒，Ctrl+C 取消。登录失败保留旧凭据。

QR 响应中的 `refresh_token` 会一并保存。`auth.refresh-check` 检查是否需要刷新；`auth.refresh` 按平台结果刷新 Cookie，没有后台自动刷新。旧凭据没有 refresh token 时，可先退出再重新扫码补齐。新凭据必须验证为相同 UID 才能替换；替换后再确认旧 token 失效。中断恢复使用凭据旁的 `.refresh.json` 私有日志：已有新凭据时继续验证/确认；刷新请求结果不明时停止，不自动再次轮换，可重新扫码恢复。日志属于敏感文件。

`auth.logout '{}'` 仅删除本地凭据和刷新日志，保留状态，不撤销其他设备会话。登录/刷新不会开启写权限、清除预算或解除暂停。运行中的 MCP 在后续操作中重新读凭据；进行中的请求使用已捕获的会话。

文件为本地明文，写入使用 POSIX 0600 或仅当前用户可访问的 Windows ACL。凭据旁的 `.lock` 串行化登录、退出和刷新；异常遗留锁必须确认进程已退出后再处理。

SDK 可使用 `loadAuth(configPath?)` 的 `login`、`status`、`refreshCheck`、`refresh`、`logout`。`QrLogin.generate/poll/verify` 支持自定义 UI，低层 `poll` 成功结果含凭据，只能交给可信宿主。CLI 和 `FileAuth` 返回脱敏账号信息。MCP 提供 `bili_auth_login`、`bili_auth_status`、`bili_auth_cancel`：开始登录立即返回原生 PNG 二维码，手机确认后保存凭据，状态查询返回进度或账号。重复启动复用当前二维码；取消、过期或连接关闭会结束本次等待并保留旧凭据。MCP 不提供退出、刷新、OAuth、审批或恢复管理工具。显式匿名配置未设置 `credentialsFile` 时不注册登录工具；嵌入式 SDK 可使用 `createMcpServer(kit, { auth: await loadAuth(configPath) })` 开启它们。

## 内容读取

下列操作直接对应 `kit.reads.<名称>(input)`；旧 SDK 方法 `dmHistory`、`liveInfo`、`liveHistory` 保持 camelCase。

| 用途                 | 操作                                            | 主要输入                                                       |
| -------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| 视频、普通搜索、字幕 | `video`、`search`、`subtitles`                  | `{bvid}`、`{keyword,page?}`、`{bvid,cid,language?}`            |
| 发现内容             | `popular`、`ranking`、`hot_search`              | `{page?,size?}`、`{rid?}`、`{}`                                |
| 分类搜索             | `search_advanced`                               | `{keyword,type?,order?,duration?,page?}`                       |
| 用户和投稿           | `user`、`user_videos`                           | `{uid}`、`{uid,page?,size?,order?}`                            |
| 社交关系             | `followings`、`followers`                       | `{uid,page?,size?}`                                            |
| 收藏                 | `favorite_folders`、`favorite_items`            | `{uid}`、`{folderId,page?,size?,keyword?}`                     |
| 个人观看记录         | `history`、`watch_later`                        | `{max?,viewAt?,business?}`、`{}`                               |
| 推荐、标签           | `related`、`tags`                               | `{bvid}`                                                       |
| 动态                 | `dynamic_feed`、`user_dynamics`、`dynamic`      | `{offset?,type?}`、`{uid,offset?}`、`{dynamicId}`              |
| 专栏                 | `articles`、`article`                           | `{uid,page?,size?}`、`{cvid}`                                  |
| 消息通知             | `notifications`                                 | `{kind,cursorId?,cursorTime?}`；kind 为 `reply/at/like/unread` |
| 评论                 | `comments`、`comment_replies`、`comment_pinned` | `{oid,page?,sort?}`、`{oid,root,page?,size?}`、`{oid}`         |
| 检查评论             | `comment_check`                                 | `{oid,rpid,root?,maxPages?}`                                   |
| 视频引用和分 P       | `resolve`                                       | `{reference,page?}`                                            |
| 字幕文本             | `transcript`                                    | `{reference,page?,language?,format?}`                          |
| 视频弹幕             | `video_danmaku`                                 | `{reference,page?,segment?}`                                   |
| B 站 AI 总结         | `video_summary`                                 | `{reference,page?}`                                            |
| 直播                 | `live_resolve`、`live_info`、`live_history`     | `{roomId}`                                                     |
| 私信历史             | `dm_history`                                    | `{uid,beforeSeq?}`                                             |
| 创作指标             | `creator_metrics`                               | `{bvid?}`                                                      |

`reference` 支持 BV、AV、数字 aid、完整视频 URL 和 `b23.tv` 短链。URL 中的 `p` 与显式 `page` 冲突会报错。解析后使用对应分 P 的 aid/bvid/cid；字幕核对返回身份，未匹配的字幕返回 `selected: null`。字幕格式支持 `json/text/srt/vtt`，不生成语音转写。`video_danmaku` 每次取一个约 6 分钟分段，输出时间戳和文本；`video_summary` 返回平台已有总结与时间提纲，不保证所有视频都有结果。

列表保留平台分页字段；调用方根据 `page`、`cursor`、`offset`、`has_more` 等继续读取，每次请求有界。`comment_check` 返回 `found/not_found/incomplete`，有限页内没找到不能证明评论已删除。创作指标来自当前账号最近最多 100 个稿件，返回覆盖范围；比率转换为百分比并保留原值，不是全部历史统计。

私信读取要求目标在 `trustedDmTargets`。返回正文和标记均为外部不可信数据；不要作为 Agent 指令或可执行 HTML。读取接口受内容可见性和账号权限限制，失败会返回错误，不把失败伪装成空列表。新增接口多数保留上游 JSON，SDK 返回 `unknown`，调用方需按实际字段校验后使用。

```ts
import { loadKit } from "@bili-agent-kit/core";

const kit = await loadKit("./config.local.json");
const popular = await kit.reads.popular({ page: 1, size: 20 });
const transcript = await kit.reads.transcript({
  reference: "BV1xx411c7mD",
  page: 2,
  format: "srt",
});
```

## 增量消息

`dm_poll {uid}` / `dm_ack {uid,receipt}` 对应 `kit.dm.peek/ack`。`events_poll` / `events_ack` 对应 `kit.events.peek/ack`，输入如下：

```json
{"source":"reply"}
{"source":"at"}
{"source":"like"}
{"source":"comments","oid":"42"}
{"source":"comments","oid":"42","root":"11"}
{"source":"live","roomId":"99"}
```

ack 输入在同一 source 参数上增加 `receipt`。首次调用建立基线，不回放历史；后续按账号和来源持久化去重，返回待处理事件，直到调用方完成持久处理并 ack。同一 receipt 可能重复投递，消费方也应去重。分页异常或积压超过 10 页时保留进度并报错。

直播仅提供近期快照，返回 `coverage: "recent_snapshot_only"`，不能承诺完整弹幕流。评论和通知也受平台返回范围限制。库不运行后台定时器，由宿主安排轮询。

## 受控写操作

所有操作通过 `write_preview`、`write_prepare`、`write_inspect`、`write_execute`，分别对应 `kit.writes.preview/prepare/inspect/execute`。新增动作默认关闭。

| action.kind                              | 主要字段                                         | allowedTargets                           |
| ---------------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| `comment.add` / `comment.delete`         | `oid,text,root?,parent?` / `oid,rpid`            | `comment:<aid>`                          |
| `dm.send`                                | `uid,text`                                       | `dm:<uid>`，还需 trustedDmTargets 和互关 |
| `live.send`                              | `roomId,text`                                    | `live:<canonical room ID>`               |
| `video.like`                             | `aid,enabled?`                                   | `video:<aid>`                            |
| `video.coin`                             | `aid,count?,like?`；count 为 1 或 2              | `video:<aid>`                            |
| `video.triple`                           | `aid`                                            | `video:<aid>`                            |
| `favorite.add` / `favorite.remove`       | `aid,folderId`                                   | `favorite:<folderId>`                    |
| `user.follow` / `user.unfollow`          | `uid`                                            | `user:<uid>`                             |
| `comment.like`                           | `oid,rpid,enabled?`                              | `comment:<aid>`                          |
| `video.danmaku`                          | `aid,cid,progressMs,text,color?,mode?,fontSize?` | `video:<aid>`                            |
| `dynamic.create`                         | `uid,text,images?`                               | `account:<uid>`                          |
| `dynamic.edit` / `dynamic.delete`        | `dynamicId,text,images?` / `dynamicId`           | `dynamic:<id>`                           |
| `open.video.publish/edit/delete`         | 见开放平台说明                                   | `open:<uid>`                             |
| `open.article.publish/edit/delete/image` | 见开放平台说明                                   | `open:<uid>`                             |

收藏会验证文件夹属于当前账号，动态编辑/删除会验证作者。`dynamic.edit` 省略 `images` 保留原图，显式 `[]` 清除原图。图片参数为 `[{"file":"/absolute/media/image.png"}]`，必须位于配置的 `mediaRoot`，最多 9 张 PNG/JPEG。准备草稿时写入 SHA256，执行前复核，批准后替换文件会被拒绝。

例如启用视频点赞，需要 `writesEnabled: true`、`allowedActions: ["video.like"]` 和 `allowedTargets: ["video:42"]`。`enabled: false` 表示取消点赞。

1. `write_preview {action}` 只校验输入并展示目标，不联网、不保存。
2. `write_prepare {action,key}` 保存规范化内容、附件摘要、账号会话、digest 和一小时有效期；可能读取账号或本地附件，不发送内容。
3. 管理员检查 `write_inspect {draftId}`，使用准确的 digest 批准：

```sh
node packages/cli/dist/main.mjs --config config.local.json admin.approve '{"draftId":"<id>","digest":"<digest>","by":"operator"}'
```

4. `write_execute {draftId}` 检查策略、会话、附件和批准后执行。同一成功草稿再次执行返回已记录结果，同一个 key 不能换内容。

多步上传逐步保存结果。明确被平台拒绝的草稿可在有效期内重新批准，复用已完成上传；请求结果不明则停止，必须先人工核查再 `admin.reconcile`，不能换 key 盲目重发。`sent` 代表平台受理，不代表审核通过。恢复方法见 [SECURITY.md](../SECURITY.md)。

SDK 管理方法为 `kit.admin.approve(id,digest,by)`、`reconcile(id,outcome)`、`resumeAccount()`。`by` 只是审计标签。MCP 不提供这些方法，但模型若能运行管理员 CLI 或修改状态文件，仍能绕过权限边界。

## 媒体与导出

需要媒体能力时添加以下配置片段：

```json
{
  "media": {
    "mediaRoot": "./media",
    "outputRoot": "./media/output",
    "ffmpegPath": "ffmpeg",
    "maxBytes": 134217728,
    "timeoutMs": 120000
  }
}
```

`mediaRoot` 限制本地输入，`outputRoot` 保存每次任务的独立结果。将输出放在输入目录之内可继续裁剪下载文件。ffmpeg 需由宿主安装；只有涉及解码/合并的操作实际调用它。每次下载默认最多 128 MiB，允许配置至 512 MiB；多轨合计计算。ffmpeg 默认最多运行 120 秒，可配置至 300 秒。

| 操作              | 输入                                                      | 结果                                               |
| ----------------- | --------------------------------------------------------- | -------------------------------------------------- |
| `media_download`  | `{reference,page?,kind?,quality?}`                        | 下载视频或音频，返回本地文件                       |
| `audio_clip`      | `{file,startSeconds?,durationSeconds?}`                   | 输出 AAC 音频片段                                  |
| `online_frames`   | `{reference,page?,count?,intervalSeconds?,contactSheet?}` | 下载后抽帧，可合成拼图                             |
| `subtitle_export` | `{reference,page?,language?,format?}`                     | JSON、TXT、SRT 或 VTT 文件                         |
| `article_export`  | `{cvid}`                                                  | 基础 Markdown 转换，包含来源链接                   |
| `live_frame`      | `{roomId}`                                                | 平台直播关键帧及获取时间                           |
| `materials`       | `{reference,page?,comments?,subtitles?,frames?}`          | 元数据、字幕、评论和可选画面，含来源、时间、缺失项 |
| `frames`          | `{file,count?,intervalSeconds?}`                          | 兼容原有本地抽帧配置                               |

SDK 使用 `kit.media.call(name,input)`，下载也可直接调用 `kit.media.download(input)`。旧 `frames` 工具仍使用 `frames: {mediaRoot,outputRoot,ffmpegPath}`，或直接调用 `sampleFrames`。默认 6 帧、间隔 10 秒，最多 12 帧；短视频可能更少。MCP 返回原生 image 内容块，文件路径属于服务端机器。

媒体请求只允许受控 B 站 CDN，Cookie 不发送到 CDN，重定向不自动跟随。支持 DASH 音视频和单段直链；不可用、仅试看或其他格式明确报错。ffmpeg 只处理下载后或根目录内的本地文件，不接收远程 URL。导出和下载会写文件；媒体结果由宿主按需要清理。文章 Markdown 是基础转换，不保证保留全部富文本排版；`materials` 不执行模型总结，未请求画面时无需媒体目录。

## 官方开放平台

视频稿件和文章稿件使用独立应用授权，扫码 Cookie 不能代替。支持独立应用凭据和显式 OAuth 授权码交换/刷新，不代办应用注册；详见 [能力扩展说明](agent-capabilities.md#官方-oauth数据和推送)。配置片段：

```json
{
  "openPlatform": {
    "credentialsFile": "./open-credentials.local.json",
    "maxUploadBytes": 134217728
  }
}
```

凭据文件包含 `clientId`、`appSecret`、`accessToken`、`uid`、`scopes`（视频 `ARC_BASE`、文章 `ATC_BASE`），可选 `expiresAt` 是毫秒 Unix 时间戳。单独安全保管，不放入 MCP 参数或日志。token 变化后重新准备和批准草稿。

读取操作为 `open_video_list`、`open_video`、`open_video_categories`、`open_article_list`、`open_article`、`open_article_categories`，SDK 调用 `kit.open.call(name,input)`。列表使用 `page/size`；详情分别使用 `resourceId`（BV）和 `articleId`。

视频发布 action 示例：

```json
{
  "kind": "open.video.publish",
  "uid": "111",
  "video": { "file": "/absolute/media/video.mp4" },
  "cover": { "file": "/absolute/media/cover.jpg" },
  "metadata": { "title": "视频标题", "tid": 21, "tag": "标签", "copyright": 1, "desc": "简介" }
}
```

上传使用连续编号的 10 MiB 分片，完成后提交稿件。封面可选，PNG/JPEG 最大 5 MiB；本地视频受 `maxUploadBytes` 约束，最大配置为 512 MiB。`open.video.edit` 使用 `uid,resourceId,metadata`，metadata 必须完整提供 `title,tid,cover,desc,no_reprint`；只编辑元数据，不替换视频。删除使用 `uid,resourceId`。

文章发布/编辑 metadata 为完整表单：`title,category,template_id,summary,content,banner_url,original,image_urls,tags,list_id,up_closed_reply,top_video_bvid`。无值字段也须明确传空字符串或 0，避免编辑时意外清空。`banner_url` 和 `top_video_bvid` 不能同时设置；`template_id` 为 3/4/5，`summary` 至少 200 字。发布使用 `uid,metadata`，编辑再加 `articleId`；删除使用 `uid,articleId`。`open.article.image` 使用 `uid,image:{file}` 上传 PNG/JPEG，返回 URL 后可用于文章草稿。

协议依据官方 [签名 2.0](https://open.bilibili.com/doc/4/8673959e-f7bb-56e6-6e68-d225f971b81b)、[视频分片](https://open.bilibili.com/doc/4/733a520a-c50f-7bb4-17cb-35338ba20500)、[视频提交](https://open.bilibili.com/doc/4/f7fc57dd-55a1-5cb1-cba4-61fb2994bf0f)、[文章发布](https://open.bilibili.com/doc/4/b14b77b6-8889-8c8b-2e83-17c5a4c550fb)。文章查询按当前文档使用 GET 表单 body，需真实授权应用进一步验证。当前完成协议模拟测试，没有执行真实投稿、编辑或删除；平台受理与最终审核结果分开。

## 状态升级与恢复

state v1/v2 首次事务前备份为对应的 `state.v1.backup.json` 或 `state.v2.backup.json`，保留原草稿、身份映射、预算和游标后迁移到 v3。升级前停止共享该目录的旧进程；旧程序会拒绝 v3。回滚前停止共享该状态的全部进程，备份最新状态；发生新写入后，不能直接覆盖为升级前备份，否则会丢失去重记录并有重复发送风险。

首次使用新会话会验证 `/x/web-interface/nav`，将会话指纹绑定到 UID。相同账号重新登录或刷新保留预算、暂停状态和游标；旧草稿继续绑定原会话。未验证过且已失效的旧会话不能猜测归属，身份或游标冲突会停止迁移，需保留文件供管理员核查。

## JSON 与错误

```json
{"version":1,"ok":true,"data":{}}
{"version":1,"ok":false,"error":{"code":"APPROVAL_REQUIRED","message":"A current administrator approval is required."}}
```

CLI 语法为 `[--config <file>] <command> [<JSON|->]`，省略 JSON 使用 `{}`，使用 `-` 从 stdin 读取 JSON；退出码为成功 `0`、输入错误 `2`、取消登录 `130`、其他失败 `1`。空轮询返回 `event: null`。MCP 返回 text 和 structuredContent，图片另用 image 内容块，stdout 仅用于 JSON-RPC。直接 SDK 方法抛出 `KitError`；`invoke/envelope` 返回上述 envelope。

错误码包括 `CANCELLED`、`INVALID_INPUT`、`NOT_FOUND`、`AUTH_REQUIRED`、`FORBIDDEN`、`APPROVAL_REQUIRED`、`CONFLICT`、`UNKNOWN_OUTCOME`、`RATE_LIMITED`、`TRAFFIC_PAUSED`、`NETWORK`、`UPSTREAM`、`STATE_INVALID`、`STATE_BUSY`、`UNAVAILABLE`。错误不回显原始响应体、Cookie 或凭据提供器错误。

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

构建后可用 `node packages/cli/dist/main.mjs help` 调用本地 CLI；可直接运行 `auth.login`，也可通过 `--config` 复用原配置。

`pnpm fmt` 会修改格式。测试使用模拟网络；`pnpm smoke` 会打包并安装三个包，检查 SDK、CLI 和 MCP 是否能正常使用。可通过 `BILI_TEST_FFMPEG` 指定本地 ffmpeg 运行真实媒体解码测试。真实账号、媒体与官方应用能力的验证范围见 [验收记录](verification.md)。

`packages/core` owns all behavior and schemas; `packages/cli` and `packages/mcp` adapt them. Build output is ESM (`.mjs`) with TypeScript declarations (`.d.mts`). Vite+ uses its own version number for the bundled Vite API; the targeted pnpm peer rules acknowledge that alias. TypeScript 7.0.2 is stable, while Vite+'s declaration emitter currently warns that its TypeScript 7 integration is experimental; declaration files and package exports are checked by `pnpm smoke`.

本页示例使用 `pnpm build` 后的本地 CLI；使用 npm 包时，将 `node packages/cli/dist/main.mjs` 替换为 `npx --yes @bili-agent-kit/cli@latest`，其他参数保持不变。

For local package verification, `pnpm --filter @bili-agent-kit/core pack --pack-destination ./artifacts` creates a package archive. When testing unpublished CLI/MCP changes, also supply the core tarball and a package-manager override resolving `@bili-agent-kit/core` to that local archive; otherwise the dependency would resolve from npm. `scripts/smoke.mjs` demonstrates the complete isolated installation. These development checks do not publish to npm; automatic releases are described below.

## 自动发布

与 [bilibili-video-summary-agent 的发布流程](https://github.com/Cansiny0320/bilibili-video-summary-agent/blob/master/.github/workflows/release.yml) 一样，本仓库通过推送 `v*` tag 触发 GitHub Actions，使用 npm Trusted Publishing（OIDC），无需保存长期 `NPM_TOKEN`。

`.github/workflows/release.yml` 先复用现有 CI 完成 Linux、Windows 检查，再校验 tag、根目录和三个包的版本一致，并要求该提交属于 `main`。发布任务在 GitHub 托管 runner 的 `npm` environment 中运行，重新构建并打包，按 core → CLI → MCP 顺序发布，核对 npm 包完整性及内部依赖版本，全部完成后创建 GitHub Release 并附上三个 tarball。

首次接入需给每个 npm 包配置 Trusted Publisher：

- GitHub repository：`Cansiny0320/bili-agent-kit`
- Workflow filename：`release.yml`
- Environment：`npm`
- 允许操作：直接 `npm publish`

GitHub 的 `npm` environment 仅允许 `v*` tag 部署。工作流发布阶段声明 `id-token: write`，不使用长期 npm token；公有仓库发布公有包时，npm 自动生成 provenance。npm 的初次配置可能需要一次安全密钥确认，以后正常 tag 发布由 CI 完成。

后续发版时，同步更新根目录与三个包的 `version`、安装示例和 `CHANGELOG.md`，完成检查并提交，推送相同版本 tag，例如：

```sh
node scripts/release.mjs check v0.3.0
git tag -a v0.3.0 -m 'Release v0.3.0'
git push origin main v0.3.0
```

示例版本仅用于说明，已发布版本不能复用。`scripts/release.mjs check` 是本地校验；`publish` 模式只允许对应 GitHub 仓库的 tag/OIDC 环境运行。

发布成功后，脚本为 npm 的后台处理和 registry 同步最多等待 10 分钟，只执行查询，不重复提交。中途失败时，在确认原因后重新运行同一次 Release workflow。脚本只跳过内容摘要完全相同的已发布版本，遇到同版本不同内容会停止；npm 网络错误不会被当作版本不存在。不覆盖 npm 版本，也不自动删除或重建远端 tag。若部分包已发布，应保留原提交和产物，处理失败后继续。

手工应急发布仍需单独授权和登录，使用检查过的 tarball，core 优先；不要直接发布私有根目录或混入 npm 上的旧 core。自动发布执行结果可在 GitHub Actions 和 npm 对应版本中回读。

依据：[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)、[npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/)。
