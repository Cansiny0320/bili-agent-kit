# @bili-agent-kit/core

Use Bilibili in TypeScript or JavaScript. Requires Node.js 22.18+, 24.11+ or 26+.

```sh
npm install @bili-agent-kit/core
```

```ts
import { loadKit } from "@bili-agent-kit/core";

const kit = await loadKit();
const video = await kit.reads.video({ bvid: "BV1xx411c7mD" });
console.log(video.title);
```

See the [usage guide](https://github.com/Cansiny0320/bili-agent-kit/blob/main/docs/usage.md) for the full API.

MIT; see LICENSE and NOTICE.md. Not affiliated with Bilibili.
