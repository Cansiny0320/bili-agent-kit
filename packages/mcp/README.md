# @bili-agent-kit/mcp

Connect your AI assistant to Bilibili. Requires Node.js 22.18+, 24.11+ or 26+.

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

Ask your assistant to log in to Bilibili, then scan and confirm with the Bilibili app.

See the [usage guide](https://github.com/Cansiny0320/bili-agent-kit/blob/main/docs/usage.md) for available tools.

MIT; see LICENSE and NOTICE.md. Not affiliated with Bilibili.
