# @bili-agent-kit/mcp

stdio MCP server for Bilibili tools. ESM; requires Node.js 22.18+, 24.11+ or 26+ (Node 23/25 unsupported).

Configure an MCP host, replacing the config path with an absolute path on your computer:

```json
{
  "mcpServers": {
    "bilibili": {
      "command": "npx",
      "args": [
        "--yes",
        "@bili-agent-kit/mcp@latest",
        "--config",
        "/absolute/path/config.local.json"
      ]
    }
  }
}
```

Example `config.local.json`:

```json
{
  "version": 1,
  "stateDir": "./.bili-agent-kit",
  "credentialsFile": "./credentials.local.json"
}
```

For authenticated access, first run the separate administrator CLI against the same config:

```sh
npx --yes @bili-agent-kit/cli@latest --config /absolute/path/config.local.json auth.login '{}'
```

The server exposes the shared public operation registry for discovery, content, media, events, controlled writes and open-platform reads. Frame tools return native image content. Login, approval, credential management and account recovery are not MCP tools. Writes remain disabled until explicitly configured and approved. Keep credentials and administrator shell access isolated from the model. stdout is reserved for JSON-RPC.

See [configuration/operations](https://github.com/Cansiny0320/bili-agent-kit/blob/main/docs/usage.md) and [security/recovery](https://github.com/Cansiny0320/bili-agent-kit/blob/main/SECURITY.md). MIT; attribution is included in LICENSE and NOTICE.md. Not affiliated with Bilibili.
