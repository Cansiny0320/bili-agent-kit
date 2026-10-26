# @bili-agent-kit/core

TypeScript SDK for Bilibili discovery, content and creator reads, media processing, QR login/Cookie refresh, approved interactions and submissions, and persistent event polling. ESM; requires Node.js 22.18+, 24.11+ or 26+ (Node 23/25 unsupported).

```sh
npm install @bili-agent-kit/core
```

```ts
import { BiliKit, FileStore, loadAuth } from "@bili-agent-kit/core";

const kit = new BiliKit({ store: new FileStore("./.bili-agent-kit") });
const video = await kit.reads.video({ bvid: "BV1xx411c7mD" });

// Trusted host: the config explicitly selects credentialsFile and stateDir.
const auth = await loadAuth("./config.local.json");
const status = await auth.status();
```

Use `loadKit(configPath)` to share the configured credentials with CLI/MCP. `QrLogin` supports custom login UIs; its success result contains credentials and must remain inside the trusted host. `FileAuth` returns only sanitized account information and supports explicit `refreshCheck()` / `refresh()`. Expanded APIs include `kit.reads.popular`, `kit.reads.transcript`, `kit.media.call`, `kit.events.peek/ack` and `kit.open.call`. Open-platform access requires separate application credentials and scopes.

Writes are disabled by default and require allowlists, durable state and administrator approval. This library is not a shell sandbox. See [configuration and API usage](https://github.com/Cansiny0320/bili-agent-kit/blob/main/docs/usage.md) and [security/recovery](https://github.com/Cansiny0320/bili-agent-kit/blob/main/SECURITY.md).

MIT; see LICENSE and NOTICE.md. Not affiliated with Bilibili.
