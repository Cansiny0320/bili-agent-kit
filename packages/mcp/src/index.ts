import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { invoke, operations, type BiliKit } from "@bili-agent-kit/core";

export function createMcpServer(kit: BiliKit): McpServer {
  const server = new McpServer({ name: "bili-agent-kit", version: "0.1.0" });
  for (const [name, op] of Object.entries(operations)) {
    server.registerTool(
      `bili_${name}`,
      {
        description: op.description,
        inputSchema: op.schema,
        annotations: {
          readOnlyHint: op.readOnly,
          destructiveHint: name === "write_execute",
          idempotentHint: name === "write_execute",
          openWorldHint: true,
        },
      },
      async (args: unknown) => {
        const result = await invoke(kit, name, args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: { ...result },
          isError: !result.ok,
        };
      },
    );
  }
  return server;
}
