import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
const work = await mkdtemp(join(tmpdir(), "bili-kit-package-"));
const pack = join(work, "packs");
await mkdir(pack);
const manager = process.env.npm_execpath;
assert.ok(manager, "Run this script with pnpm smoke.");
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
  });
  assert.equal(result.status, 0, `${command} failed: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
function pnpm(args, cwd) {
  return /\.[cm]?js$/.test(manager)
    ? run(process.execPath, [manager, ...args], cwd)
    : run(manager, args, cwd);
}
for (const pkg of ["core", "cli", "mcp"])
  pnpm(["pack", "--pack-destination", pack], join(root, "packages", pkg));
const dependencies = {};
for (const pkg of ["core", "cli", "mcp"]) {
  const name = (await readdir(pack)).find((name) => name === `bili-agent-kit-${pkg}-0.1.0.tgz`);
  assert.ok(name, `Missing packed ${pkg}`);
  dependencies[`@bili-agent-kit/${pkg}`] = `file:${join(pack, name).replaceAll("\\", "/")}`;
}
await writeFile(
  join(work, "package.json"),
  JSON.stringify({ private: true, type: "module", dependencies }),
);
// The packages are intentionally unpublished: resolve the CLI/MCP transitive core edge locally too.
await writeFile(
  join(work, "pnpm-workspace.yaml"),
  `overrides:\n  '@bili-agent-kit/core': ${JSON.stringify(dependencies["@bili-agent-kit/core"])}\n`,
);
pnpm(["install", "--ignore-scripts"], work);
await writeFile(
  join(work, "verify.mjs"),
  `
import assert from 'node:assert/strict';
import {BiliKit,MemoryStore,invoke} from '@bili-agent-kit/core';
import {runCli} from '@bili-agent-kit/cli';
import {createMcpServer} from '@bili-agent-kit/mcp';
const kit = new BiliKit({store:new MemoryStore()});
const r = await invoke(kit,'write_preview',{action:{kind:'dm.send',uid:'222',text:'hello'}});
assert.equal(r.ok,true);
assert.equal((await runCli(['help'],async()=>'' )).ok,true);
await createMcpServer(kit).close();
console.log('Packed SDK/CLI/MCP exports passed');
`,
);
process.stdout.write(run(process.execPath, [join(work, "verify.mjs")], work));
await writeFile(
  join(work, "consumer.mts"),
  `
import {BiliKit,MemoryStore,type Video,type WriteActionInput} from '@bili-agent-kit/core';
import {runCli} from '@bili-agent-kit/cli';
import {createMcpServer} from '@bili-agent-kit/mcp';
const kit=new BiliKit({store:new MemoryStore()});
const action:WriteActionInput={kind:'comment.add',oid:'42',text:'hello'};
kit.writes.preview(action);
const video:Promise<Video>=kit.reads.video({bvid:'BV1xx411c7mD'});
void video; void runCli; void createMcpServer;
// @ts-expect-error The SDK must not expose arbitrary POST requests.
kit.reads.post('/msg/send',{});
`,
);
await writeFile(
  join(work, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      target: "ES2023",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    include: ["consumer.mts"],
  }),
);
run(
  process.execPath,
  [join(root, "node_modules/typescript/bin/tsc"), "--project", join(work, "tsconfig.json")],
  work,
);
const cli = join(work, "node_modules/@bili-agent-kit/cli/dist/main.mjs");
assert.equal(JSON.parse(run(process.execPath, [cli, "help"], work)).ok, true);
const invalid = spawnSync(process.execPath, [cli, "invalid"], {
  cwd: work,
  encoding: "utf8",
  windowsHide: true,
});
assert.equal(invalid.status, 2);
assert.equal(JSON.parse(invalid.stdout).ok, false);
for (const pkg of ["core", "cli", "mcp"]) {
  const location = join(work, `node_modules/@bili-agent-kit/${pkg}`);
  assert.match(await readFile(join(location, "LICENSE"), "utf8"), /ALTERSSSS/);
  assert.match(await readFile(join(location, "NOTICE.md"), "utf8"), /3e11454/);
  const manifest = JSON.parse(await readFile(join(location, "package.json"), "utf8"));
  await readFile(join(location, manifest.exports["."].types));
}
// Exercise the built stdio entrypoint through the actual MCP client in its installed package context.
const mcpEntry = join(work, "node_modules/@bili-agent-kit/mcp/dist/main.mjs");
const config = join(work, "config.json");
await writeFile(config, JSON.stringify({ version: 1, stateDir: "./state" }));
const probe = join(work, "node_modules/@bili-agent-kit/mcp/stdio-smoke.mjs");
await writeFile(
  probe,
  `
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const client=new Client({name:'smoke',version:'1'});
const transport=new StdioClientTransport({command:process.execPath,args:[${JSON.stringify(mcpEntry)},'--config',${JSON.stringify(config)}],stderr:'pipe'});
try { await client.connect(transport); const listed=await client.listTools(); assert.equal(listed.tools.length,14); const result=await client.callTool({name:'bili_write_preview',arguments:{action:{kind:'dm.send',uid:'222',text:'hello'}}}); assert.equal(result.structuredContent.ok,true); console.log('Built MCP stdio passed'); } finally {await client.close();}
`,
);
process.stdout.write(run(process.execPath, [probe], dirname(probe)));
console.log(
  "Pack/install, binary JSON/exit codes, declarations, licenses and stdio checks passed.",
);
