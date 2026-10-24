# Source and third-party notices

Protocol code is adapted directly from [Alterssss/dsh-bili-whale](https://github.com/Alterssss/dsh-bili-whale), v0.4.6, commit `3e11454a5961300aa7094df0f08e630bd39999dd`, copyright (c) 2026 ALTERSSSS, under MIT. The original copyright and license are preserved in LICENSE. bili-agent-kit modifications are copyright (c) 2026 Cansiny0320, also MIT.

Source mapping:

| Original file                                                                 | Adaptation                                                                                                                 |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| tools/lib/bili-api.mjs                                                        | WBI mixing table, canonical signing and signed video endpoints in core/wbi.ts and core/client.ts                           |
| tools/lib/traffic.mjs                                                         | Conservative budgets, account isolation, persistent risk backoff and uncertain sends in core/traffic.ts and core/writes.ts |
| tools/lib/dm-history.mjs                                                      | Sequence pagination, same-second deduplication and fail-closed cursors in core/poll.ts                                     |
| tools/commands/{search,subtitles,comments,comment,comment-del,dm,danmaku}.mjs | Read/write endpoints and form parameters                                                                                   |

Modified: strict TypeScript, injected credentials/storage/transport/clock, immutable drafts with separate administrator approval, shared SDK/JSON CLI/MCP schemas, explicit local configuration, typed errors, tests and packaging. Removed: DSH/Codex host integration, home-directory assumptions, persona, AI sessions, background scheduling, dashboard and automatic publication. No sibling-port source was used.

This is an independent, unofficial tool. Bilibili does not endorse or maintain it. Bilibili web interfaces may change without notice. The upstream repository references bilibili-API-collect; its documentation is not copied into this distribution.

ffmpeg is optional, separately installed, and not bundled. Its own LGPL/GPL terms depend on the chosen build: https://ffmpeg.org/legal.html. Node.js, Zod, MCP SDK, TypeScript, pnpm and Vite+ retain their respective licenses. The sponsorship image in the repository is reused from Cansiny0320/Nexlet at the owner's request; it is not included in the npm packages.
