# Contributing

Use a supported Node version and pnpm 12.15.0. Keep protocol behavior in `packages/core`; adapters must share the operation schemas. Preserve upstream notices and document any additional source used.

Before submitting a change, run `pnpm check`, `pnpm test`, `pnpm build`, and `pnpm smoke`. Run `pnpm fmt` explicitly when formatting is needed; it writes files. The build writes package `dist` directories and copies license notices. Smoke checks create temporary package installs and may download public dependencies. Do not use real credentials or send Bilibili messages in tests.

Add meaningful regression coverage for approval, persistence, protocol or cursor behavior. Prefer injected fetch/clock and fixture data. Preserve unknown send outcomes and fail closed on corrupt state. Any new externally visible write must go through the existing immutable-draft approval and execution path; never add a direct send tool or a model-controlled approval parameter.
