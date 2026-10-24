# @bili-agent-kit/core

TypeScript SDK for Bilibili reads, QR login, administrator-approved writes and persistent DM polling. ESM; requires Node.js 22.18+, 24.11+ or 26+ (Node 23/25 unsupported).

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

Use `loadKit(configPath)` to share the configured credentials with CLI/MCP. `QrLogin` supports custom login UIs; its success result contains credentials and must remain inside the trusted host. `FileAuth` returns only sanitized account information.

Writes are disabled by default and require allowlists, durable state and administrator approval. This library is not a shell sandbox. See [configuration and API usage](https://github.com/Cansiny0320/bili-agent-kit/blob/main/docs/usage.md) and [security/recovery](https://github.com/Cansiny0320/bili-agent-kit/blob/main/SECURITY.md).

MIT; see LICENSE and NOTICE.md. Not affiliated with Bilibili.
