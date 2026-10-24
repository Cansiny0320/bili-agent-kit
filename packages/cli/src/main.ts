#!/usr/bin/env node
import { runCli } from "./index.js";
const result = await runCli(process.argv.slice(2), async () => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > 1024 * 1024) throw new Error("Input limit");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
});
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = result.ok ? 0 : result.error.code === "INVALID_INPUT" ? 2 : 1;
