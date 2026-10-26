import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { invoke, operations, type BiliKit, type MediaImage } from "@bili-agent-kit/core";

export function createMcpServer(kit: BiliKit): McpServer {
  const server = new McpServer({ name: "bili-agent-kit", version: "0.3.0" });
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
        const images: MediaImage[] = [];
        const view = JSON.parse(
          JSON.stringify(result, (key, value: unknown) => {
            if (
              key === "images" &&
              Array.isArray(value) &&
              ["frames", "online_frames", "live_frame", "materials"].includes(name)
            ) {
              for (const item of value)
                if (
                  item?.type === "image" &&
                  ["image/png", "image/jpeg"].includes(item.mimeType) &&
                  typeof item.data === "string"
                )
                  images.push(item as MediaImage);
              return undefined;
            }
            return value;
          }),
        ) as Record<string, unknown>;
        return {
          content: [{ type: "text" as const, text: JSON.stringify(view) }, ...images],
          structuredContent: view,
          isError: !result.ok,
        };
      },
    );
  }
  return server;
}
