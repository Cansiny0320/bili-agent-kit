# Verification record

Validated locally on 2026-10-25 with Windows, Node 24.19.0, pnpm 12.15.0, Vite+ 1.4.0 and TypeScript 7.0.2.

- `pnpm check`: formatting, Oxlint type-aware checks and TypeScript passed without warnings/errors.
- `pnpm test`: 30 tests passed across 7 files, using simulated requests and temporary state. Includes WBI parity with upstream, file-store concurrency/corruption, approval/digest/account binding, durable uncertain sends, endpoint forms, budgets/backoff, subtitle credential isolation, DM pagination/replay/ack, CLI, MCP, and ffmpeg invocation boundaries.
- `pnpm build`: all three ESM packages and declarations generated. The Vite+ declaration emitter reports its TypeScript 7 integration as experimental; compilation and separate consumer type checks passed.
- `pnpm smoke`: local tarballs installed independently, SDK/CLI/MCP exports and CLI JSON/exit codes passed; TypeScript consumer compiled against packaged declarations; built MCP stdio negotiated and called a tool; license notices included in each package.
- `pnpm peers check`: no peer dependency issues.

No real Bilibili credentials were read and no real Bilibili content was sent. No npm publication or hosted service deployment was performed. Live-account compatibility and actual ffmpeg decoding remain unverified; ffmpeg was not available on the local PATH, so invocation tests use a controlled process mock. CI repeats the workspace and package checks on Windows and Linux; see GitHub Actions for the current remote result.
