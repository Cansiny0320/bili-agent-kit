import { expect, it } from "vite-plus/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../packages/mcp/src/index.js";
import { runCli } from "../packages/cli/src/index.js";
import { setup } from "./helpers.js";

it("MCP negotiates and exposes public tools without administrator capabilities", async () => {
  const { kit, calls } = await setup();
  const server = createMcpServer(kit);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name)).toContain("bili_write_execute");
    expect(tools.some((t) => /approve|admin|policy|credential|resume|reconcile/.test(t.name))).toBe(
      false,
    );
    const result = await client.callTool({
      name: "bili_write_preview",
      arguments: { action: { kind: "dm.send", uid: "222", text: "hello" } },
    });
    expect(result.structuredContent).toMatchObject({
      version: 1,
      ok: true,
      data: { target: "dm:222" },
    });
    const invalid = await client.callTool({
      name: "bili_write_execute",
      arguments: { draftId: "a".repeat(64), approved: true },
    });
    expect(invalid.isError).toBe(true);
    expect(calls).toHaveLength(0);
  } finally {
    await client.close();
    await server.close();
  }
});
it("CLI shares schemas, uses stdin JSON, and rejects unknown admin fields", async () => {
  const { kit } = await setup();
  const load = async () => kit;
  const args = ["--config", "unused", "write_preview", "-"];
  expect(
    await runCli(
      args,
      async () => JSON.stringify({ action: { kind: "live.send", roomId: "99", text: "hello" } }),
      load,
    ),
  ).toMatchObject({ version: 1, ok: true });
  expect(
    await runCli(
      ["--config", "unused", "admin.approve", '{"approved":true}'],
      async () => "",
      load,
    ),
  ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  expect(
    await runCli(["--config", "unused", "video", "bad-json"], async () => "", load),
  ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
});
