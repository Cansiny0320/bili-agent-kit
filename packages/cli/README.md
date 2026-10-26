# @bili-agent-kit/cli

JSON command line interface for discovery, content, media, events, approved writes and trusted account administration for bili-agent-kit. ESM; requires Node.js 22.18+, 24.11+ or 26+ (Node 23/25 unsupported).

```sh
npx --yes @bili-agent-kit/cli@0.2.0 help
npx --yes @bili-agent-kit/cli@0.2.0 --config ./config.local.json auth.login '{}'
npx --yes @bili-agent-kit/cli@0.2.0 --config ./config.local.json auth.status '{}'
```

Create `config.local.json` before login:

```json
{
  "version": 1,
  "stateDir": "./.bili-agent-kit",
  "credentialsFile": "./credentials.local.json"
}
```

Scan with the Bilibili app and confirm on your phone. QR/progress goes to stderr; stdout contains JSON. Login can save a PNG with `'{"png":"login-qr.png"}'`. Credentials are stored as a local plaintext file with restricted permissions; failed login preserves the previous file. `auth.logout '{}'` removes only local credentials, preserving history and other devices' sessions.

`help` lists the shared operation schemas. Trusted commands also include `auth.refresh-check` and `auth.refresh`; refresh is explicit, not scheduled. New interactions and open-platform submissions require action and target allowlists. Open-platform credentials are independent from QR login.

Writes are disabled by default. Administrator commands must be separated from model-controlled shell access. See [operations/configuration](https://github.com/Cansiny0320/bili-agent-kit/blob/main/docs/usage.md) and [security/recovery](https://github.com/Cansiny0320/bili-agent-kit/blob/main/SECURITY.md).

MIT; see LICENSE and NOTICE.md. Not affiliated with Bilibili.
