# @bili-agent-kit/cli

JSON command line interface for discovery, content, media, events, approved writes and trusted account administration for bili-agent-kit. ESM; requires Node.js 22.18+, 24.11+ or 26+ (Node 23/25 unsupported).

```sh
npx --yes @bili-agent-kit/cli@latest help
npx --yes @bili-agent-kit/cli@latest auth.login
npx --yes @bili-agent-kit/cli@latest auth.status
```

Configuration is created automatically at `~/.bili-agent-kit/config.json`; credentials and state are shared with MCP. Keep using `--config <file>` for existing/custom configurations. JSON arguments are optional and default to `{}`.

An existing valid login is reused. To change accounts, run `auth.logout` first. Scan with the Bilibili app and confirm on your phone. QR/progress goes to stderr; stdout contains JSON. Login can save a PNG with `'{"png":"login-qr.png"}'`. Credentials are stored as a local plaintext file with restricted permissions; failed login preserves the previous file. `auth.logout '{}'` removes only local credentials, preserving history and other devices' sessions.

`help` lists the shared operation schemas. Trusted commands also include `auth.refresh-check` and `auth.refresh`; refresh is explicit, not scheduled. New interactions and open-platform submissions require action and target allowlists. Open-platform credentials are independent from QR login.

Writes are disabled by default. Administrator commands must be separated from model-controlled shell access. See [operations/configuration](https://github.com/Cansiny0320/bili-agent-kit/blob/main/docs/usage.md) and [security/recovery](https://github.com/Cansiny0320/bili-agent-kit/blob/main/SECURITY.md).

MIT; see LICENSE and NOTICE.md. Not affiliated with Bilibili.
