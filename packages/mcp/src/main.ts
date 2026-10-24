#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadKit } from "@bili-agent-kit/core";
import { createMcpServer } from "./index.js";
try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--config" || !args[1]) throw new Error("config");
  const server = createMcpServer(await loadKit(args[1]));
  await server.connect(new StdioServerTransport());
} catch {
  process.stderr.write("bili-agent-mcp: startup failed; expected --config <valid config file>.\n");
  process.exitCode = 1;
}
