import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  invoke,
  operations,
  type BiliKit,
  type MediaImage,
  type FileAuth,
} from "@bili-agent-kit/core";
import { z } from "zod";
import { McpAuth } from "./auth.js";

export function createMcpServer(
  kit: BiliKit,
  options: { auth?: Pick<FileAuth, "login" | "status"> } = {},
): McpServer {
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
  if (options.auth) {
    const auth = new McpAuth(options.auth);
    for (const [name, description] of Object.entries({
      login:
        "Show a QR image to sign in with the Bilibili app. Confirm on your phone, then use bili_auth_status. Keeps an existing valid login.",
      status: "Check login progress or the current account. Never returns credentials.",
      cancel: "Cancel this MCP connection's pending QR login; keeps saved credentials.",
    })) {
      server.registerTool(
        `bili_auth_${name}`,
        {
          description,
          inputSchema: z.strictObject({}),
          annotations: {
            readOnlyHint: name === "status",
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
          },
        },
        async () => {
          const { result, image } =
            name === "login"
              ? await auth.login()
              : {
                  result: name === "status" ? await auth.status() : await auth.cancel(),
                  image: undefined,
                };
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result) },
              ...(image ? [image] : []),
            ],
            structuredContent: result,
            isError: !result.ok,
          };
        },
      );
    }
    const close = server.close.bind(server);
    server.close = async () => {
      await auth.close();
      await close();
    };
    const onclose = server.server.onclose;
    server.server.onclose = () => {
      void auth.close();
      onclose?.();
    };
  }
  return server;
}
