# 素材、收藏管理与官方事件

这些操作仍由 core 实现，CLI 使用相同名称，MCP 加 `bili_` 前缀。官方授权管理、Webhook 接收和直播连接只交给可信宿主。

## 合集与个人列表

| 操作                | 输入                                                                |
| ------------------- | ------------------------------------------------------------------- |
| `collections`       | `{uid,page?,size?}`，列出该 UP 的合集和系列                         |
| `collection_videos` | `{uid,seasonId,page?,size?}`                                        |
| `series`            | `{seriesId}`                                                        |
| `series_videos`     | `{uid,seriesId,page?,size?}`                                        |
| `watch_later_page`  | `{startKey?,splitKey?,ascending?,sortField?}`                       |
| `favorite_search`   | `{keyword,folderId?,startOid?,startType?,searchCount?,page?,size?}` |

目录接口保留上游分页字段。稍后再看把 `next_key` 和 `split_key` 传入下一次调用的 `startKey`、`splitKey`；`ascending` 默认 false。`sortField` 是服务端整数代码，默认 0；其他值的具体排序含义尚未验证，不为其提供猜测的名称。收藏搜索也保留服务端分页和游标，不把单页结果当作全部内容。

## 收藏和稍后再看写操作

通过 `write_prepare` → 管理员 `admin.approve` → `write_execute` 执行。默认关闭，需要逐个启用 `allowedActions`，并允许下表中的全部目标。批量最多 50 个不重复的视频 aid。

| action.kind                              | 主要输入                                 | allowedTargets                                  |
| ---------------------------------------- | ---------------------------------------- | ----------------------------------------------- |
| `watch_later.add` / `watch_later.remove` | `aid`                                    | `video:<aid>`                                   |
| `watch_later.batch_add`                  | `aids`                                   | 每个 `video:<aid>`                              |
| `watch_later.move`                       | `aids,folderId`                          | 每个 `video:<aid>` 和目标 `favorite:<folderId>` |
| `favorite.folder_create`                 | `uid,title,intro?,cover?,privacy?`       | `account:<uid>`                                 |
| `favorite.folder_edit`                   | `folderId,title?,intro?,cover?,privacy?` | `favorite:<folderId>`                           |
| `favorite.copy` / `favorite.move`        | `aids,sourceFolderId,folderId`           | 源、目标两个 `favorite:<folderId>`              |
| `favorite.sort`                          | `folderId,aid,afterAid`                  | `favorite:<folderId>`                           |

新建默认 `privacy: 1`（私密），0 为公开。编辑至少指定一个字段；prepare 会读取并保留未指定字段，将旧字段快照绑定到审批摘要。execute 发现文件夹已被其他操作修改时拒绝发送，需重新准备。`expected` 是准备阶段生成的快照字段，不需要手填。

跨夹操作验证两边归属及源成员。排序将 `aid` 放到 `afterAid` 后面，两个视频都必须已在该夹内；首版不提供未经确认的“置顶 0”编码。新库管理动作会完整、有界地回读最多 20 页；超过范围或回读不一致时不会宣称全部成功。`write_inspect` 的 `steps.verify.result.items` 保存已取得的逐项核对结果。未知结果不自动重发。

## 时间素材与本地 ASR

`frames`、`online_frames` 和 `materials` 新增：

- `timestampsSeconds: [12.5, 31]`：最多 12 个明确时间点。
- 或 `startSeconds/endSeconds`：在范围内按 `intervalSeconds` 抽取，受 `count` 限制。

两种方式互斥。`transcript` 和 `subtitle_export` 同样支持 `startSeconds/endSeconds`；字幕裁剪后保留原视频时间轴。超出视频的抽帧点会明确失败，不把少帧结果冒充全部请求点。

在媒体配置内显式启用 ASR：

```json
{
  "media": {
    "mediaRoot": "./media",
    "outputRoot": "./media/output",
    "ffmpegPath": "ffmpeg",
    "asr": {
      "executable": "whisper-cli",
      "model": "./models/ggml-base.bin",
      "threads": 4,
      "timeoutMs": 300000
    }
  }
}
```

```sh
bili-agent --config config.local.json asr_transcribe '{"reference":"BV1EJ411i7Q9","startSeconds":30,"durationSeconds":60,"language":"zh","format":"srt"}'
bili-agent --config config.local.json asr_transcribe '{"file":"/absolute/media/audio.wav","language":"auto"}'
```

`file` 与 `reference` 二选一；线上视频可指定 `page`。默认最多转写 600 秒，可请求至 3600 秒。FFmpeg 将所选音轨转换为 16 kHz 单声道，whisper.cpp 在本地运行。结果标记 `generated: true`，分段时间含原视频偏移；中间 WAV/JSON 会清理，下载的源音频按现有媒体输出规则保留。语音转写不自动代替字幕，不上传到云端。识别精度取决于音质和模型。

## UP、合集与系列增量事件

```sh
bili-agent --config config.local.json events_poll '{"source":"user_videos","uid":"2267573"}'
bili-agent --config config.local.json events_poll '{"source":"collection","uid":"2267573","seasonId":"514597"}'
bili-agent --config config.local.json events_poll '{"source":"series","uid":"2267573","seriesId":"396050"}'
```

第一次完整扫描只建立基线，之后返回新加入的成员；旧视频新加入合集也会产生事件。`message.ts` 是观察时间，`message.data.publishedAt` 保留原发布时间。待处理事件持续重放，使用同样的 source/uid/集合 ID 和 `receipt` 调用 `events_ack` 后推进。

默认最多扫描 20 页，`maxPages` 可设至 100，最多 10000 个成员。页数不足、重复页、总数变化等情况保留原游标并报错。公开源支持匿名读取，匿名和登录账号分别维护游标。仅能检测两次完整快照间可见的成员变化；库不启动后台轮询。

## 官方 OAuth、数据和推送

先申请并配置自己的开放平台应用。Cookie 登录不能代替应用授权。`openPlatform.credentialsFile` 指向独立私有 JSON，初始填写 `clientId`、`appSecret`、`uid`；`uid` 是宿主绑定的数字账号标识，OAuth token 响应本身不返回它。

```sh
bili-agent --config config.local.json open.auth.begin '{"redirectUrl":"https://your-domain.example/oauth"}'
# 用户完成官方授权后，把回调中的 code 和 state 通过 stdin 交给以下命令。
bili-agent --config config.local.json open.auth.exchange -
bili-agent --config config.local.json open.auth.status '{}'
bili-agent --config config.local.json open.auth.refresh '{}'
```

SDK 对应 `loadOpenAuth(configPath)`。begin 保存十分钟有效的一次性 state；exchange 校验并消费它。官方 `expires_in` 实际表示 UTC 绝对秒时间，保存为毫秒 `expiresAt`。refresh 在到期前显式调用，文件锁防止并发使用一次性 refresh token；网络结果不明时保留 `refreshPending`，必须重新授权。管理命令不返回 token。`open.auth.logout` 仅清除本地 token，不撤销平台授权。新增 scope 需要重新授权。

`open_video_stats {}` 要求 `ARC_DATA`，返回官方近 30 天整体聚合增量，不能当作逐日曲线。

投稿回调要求 `USER_INFO`，且只覆盖本应用投递的视频。将授权用户的 `openId` 配置到凭据中后，可信 HTTPS 宿主将原始请求字节和 `x-bilibili-signature` 交给：

```ts
const response = await kit.openEvents.receiveWebhook(rawBody, signature);
// 此后返回 HTTP 2xx 和 response；失败时不要提前确认送达。
```

SDK 按官方 `SHA1(secret + rawBody)` 验签，校验应用和用户，处理验证挑战，持久化 `video_open/video_fail` 并去重。宿主负责 HTTPS、限制请求体至 1 MiB，并在官方 5 秒超时前应答。库不会自行部署接收服务。单个队列最多 1000 个待处理事件，保留最近 10000 个去重键；消费方仍应以业务事件标识保证幂等。

官方直播要求 `LIVE_ROOM_DATA`，由宿主显式运行：

```ts
const controller = new AbortController();
const running = kit.openLive.run({ signal: controller.signal, maxReconnects: 3 });
// 宿主退出时：controller.abort(); await running;
```

适配器执行官方 ws-start、二进制鉴权、zlib 解包及 HTTP/WS 心跳，断线最多重连指定次数。账号变化、鉴权拒绝、服务退避、队列满等情况会停止并报错。结束连接后停止心跳；平台按心跳超时停止推送。网络断开期间可能漏消息，不承诺无损回放。

CLI/MCP 仅消费持久队列：`open_events_poll {"source":"webhook"}` 或 `{"source":"live"}`，处理完成后 `open_events_ack {source,receipt}`。不开放注入事件、启动长连接或修改 OAuth 凭据的模型工具。OAuth/直播服务请求有独立预算（600 次/小时、10000 次/天），仍共享请求间隔和平台退避，不占普通内容写入限额。

## 状态升级

状态格式升级到 v3。首次事务前保留 `state.v1.backup.json` 或 `state.v2.backup.json`，迁移保留既有流量、草稿和游标。升级时须停止使用同一目录的旧进程；旧程序会拒绝 v3，不能交替使用。降级应在停止所有写入后恢复对应备份，新事件和新草稿不能直接交给旧程序。本次真实账号协议验证使用旧版状态处理器，未升级共享登录状态。

## 协议依据

- [OAuth 与绝对过期时间](https://open.bilibili.com/doc/4/eaf0e2b5-bde9-b9a0-9be1-019bb455701c)、[网页授权入口](https://open.bilibili.com/doc/4/aac73b2e-4ff2-b75c-4c96-35ced865797b)
- [创作数据](https://open.bilibili.com/doc/4/708a4ce5-5a6e-d8ce-b2e8-ff8a26a83b05)、[Webhook 签名和确认](https://open.bilibili.com/doc/4/b369a652-0e26-8ddb-74f0-20c74234fcd6)
- [直播连接](https://open.bilibili.com/doc/4/da2b13dc-7f7a-0025-be11-0b677e793baa)、[WebSocket 协议](https://open.bilibili.com/doc/4/5cac94fe-57f9-06db-7515-523d81c44f85)、[HTTP 心跳](https://open.bilibili.com/doc/4/8f57c906-15e6-4e61-e850-da0911be1cf1)
- 收藏扩展另据 B 站 Android 9.16.1 APK 的 Retrofit 声明、资源编码调用链与已授权账号的临时条目验证；不是官方公开 API 的稳定性承诺。
