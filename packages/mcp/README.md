# @bili-agent-kit/mcp

stdio MCP server for Bilibili tools. ESM; requires Node.js 22.18+, 24.11+ or 26+ (Node 23/25 unsupported).

Configure an MCP host:

```json
{
  "mcpServers": {
    "bilibili": {
      "command": "npx",
      "args": ["--yes", "@bili-agent-kit/mcp@latest"]
    }
  }
}
```

Configuration and login state are created automatically under `~/.bili-agent-kit/` and shared with CLI. Use `--config <absolute path>` to keep an existing/custom configuration.

Call `bili_auth_login` to display a QR image, scan and confirm in the Bilibili app, then use `bili_auth_status`. `bili_auth_cancel` cancels only this pending login. Existing valid logins are reused. Explicit anonymous configurations without `credentialsFile` omit the three login tools. Embedded hosts opt in with `createMcpServer(kit, { auth: await loadAuth(configPath) })`.

The server exposes the shared public operation registry for discovery, content, media, events, controlled writes and open-platform reads. Frame tools return native image content. Approval, credential export, logout, refresh, OAuth management and account recovery are not MCP tools. Writes remain disabled until explicitly configured and approved. Keep credentials and administrator shell access isolated from the model. stdout is reserved for JSON-RPC.

See [configuration/operations](https://github.com/Cansiny0320/bili-agent-kit/blob/main/docs/usage.md) and [security/recovery](https://github.com/Cansiny0320/bili-agent-kit/blob/main/SECURITY.md). MIT; attribution is included in LICENSE and NOTICE.md. Not affiliated with Bilibili.
