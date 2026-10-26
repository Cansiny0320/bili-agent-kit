#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadKit, loadAuth, KitError } from "@bili-agent-kit/core";
import { createMcpServer } from "./index.js";
try {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--config" || !args[1]))
    throw new Error("config");
  const kit = await loadKit(args[1]);
  // Explicit anonymous configs remain usable without adding credential storage.
  const auth = await loadAuth(args[1]).catch((error: unknown) => {
    if (
      error instanceof KitError &&
      error.code === "INVALID_INPUT" &&
      error.message.startsWith("Set credentialsFile")
    )
      return undefined;
    throw error;
  });
  const server = createMcpServer(kit, auth ? { auth } : {});
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void server.close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  process.stdin.once("end", close);
  await server.connect(new StdioServerTransport());
} catch {
  process.stderr.write(
    "bili-agent-mcp: startup failed; check the default config or pass --config <valid config file>.\n",
  );
  process.exitCode = 1;
}
