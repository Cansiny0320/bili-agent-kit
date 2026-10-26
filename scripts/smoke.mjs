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
  const manifest = JSON.parse(await readFile(join(root, "packages", pkg, "package.json"), "utf8"));
  const name = (await readdir(pack)).find(
    (name) => name === `bili-agent-kit-${pkg}-${manifest.version}.tgz`,
  );
  assert.ok(name, `Missing packed ${pkg}`);
  dependencies[`@bili-agent-kit/${pkg}`] = `file:${join(pack, name).replaceAll("\\", "/")}`;
}
await writeFile(
  join(work, "package.json"),
  JSON.stringify({ private: true, type: "module", dependencies }),
);
// Resolve local candidate dependencies instead of mixing them with the published core.
await writeFile(
  join(work, "pnpm-workspace.yaml"),
  `overrides:\n  '@bili-agent-kit/core': ${JSON.stringify(dependencies["@bili-agent-kit/core"])}\n`,
);
pnpm(["install", "--ignore-scripts"], work);
await writeFile(
  join(work, "verify.mjs"),
  `
import assert from 'node:assert/strict';
import {BiliKit,MemoryStore,invoke,QrLogin,FileCredentials,loadAuth,loadOpenAuth,defaultConfigPath,describeOperations} from '@bili-agent-kit/core';
import {runCli} from '@bili-agent-kit/cli';
import {createMcpServer} from '@bili-agent-kit/mcp';
const kit = new BiliKit({store:new MemoryStore()});
const r = await invoke(kit,'write_preview',{action:{kind:'dm.send',uid:'222',text:'hello'}});
assert.equal(r.ok,true);
assert.equal((await runCli(['help'],async()=>'' )).ok,true);
assert.equal(typeof new QrLogin().generate,'function');
assert.equal(typeof FileCredentials,'function');
assert.equal(typeof loadAuth,'function');
assert.equal(typeof defaultConfigPath,'function');
assert.equal(typeof kit.reads.popular,'function');
assert.equal(typeof kit.media.download,'function');
assert.equal(typeof kit.events.peek,'function');
assert.equal(typeof kit.open.call,'function');
assert.equal(typeof loadOpenAuth,'function');
assert.equal(typeof kit.openEvents.receiveWebhook,'function');
assert.equal(typeof kit.openLive.run,'function');
for (const name of ['collections','watch_later_page','favorite_search','asr_transcribe','open_video_stats','open_events_poll']) assert.ok(describeOperations()[name]);
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
const interaction:WriteActionInput={kind:'video.coin',aid:'42',count:2};
const publish:WriteActionInput={kind:'open.video.publish',uid:'111',video:{file:'/media/test.mp4'},metadata:{title:'test',tid:21,tag:'test'}};
kit.writes.preview(interaction); kit.writes.preview(publish);
void kit.reads.popular({page:1});
void kit.media.call('online_frames',{reference:'BV1xx411c7mD',contactSheet:true});
void kit.open.call('open_article_list',{page:1});
void kit.reads.collection_videos({uid:'1',seasonId:'2'});
void kit.media.call('asr_transcribe',{file:'/media/audio.wav',language:'zh'});
kit.writes.preview({kind:'favorite.move',sourceFolderId:'1',folderId:'2',aids:['42']});
// @ts-expect-error New SDK inputs must retain their declared types.
kit.reads.popular({page:'wrong'});
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
  assert.equal(
    await readFile(join(location, "LICENSE"), "utf8"),
    await readFile(join(root, "LICENSE"), "utf8"),
  );
  assert.equal(
    await readFile(join(location, "NOTICE.md"), "utf8"),
    await readFile(join(root, "NOTICE.md"), "utf8"),
  );
  const manifest = JSON.parse(await readFile(join(location, "package.json"), "utf8"));
  await readFile(join(location, manifest.exports["."].types));
}
// Exercise the built stdio entrypoint through the actual MCP client in its installed package context.
const mcpEntry = join(work, "node_modules/@bili-agent-kit/mcp/dist/main.mjs");
const config = join(work, "config.json");
await writeFile(
  config,
  JSON.stringify({ version: 1, stateDir: "./state", credentialsFile: "./credentials.json" }),
);
const authStatus = JSON.parse(
  run(
    process.execPath,
    [
      join(work, "node_modules/@bili-agent-kit/cli/dist/main.mjs"),
      "--config",
      config,
      "auth.status",
    ],
    work,
  ),
);
assert.deepEqual(authStatus, { version: 1, ok: true, data: { authenticated: false } });
const probe = join(work, "node_modules/@bili-agent-kit/mcp/stdio-smoke.mjs");
await writeFile(
  probe,
  `
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {operations} from '@bili-agent-kit/core';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const client=new Client({name:'smoke',version:'1'});
const anonymous = process.argv[2] === 'anonymous';
const transport=new StdioClientTransport({command:process.execPath,args:[${JSON.stringify(mcpEntry)},'--config',${JSON.stringify(config)}],stderr:'pipe'});
try { await client.connect(transport); const listed=await client.listTools(); assert.deepEqual(listed.tools.map(t=>t.name).sort(),[...Object.keys(operations).map(name=>"bili_"+name),...(anonymous?[]:['bili_auth_login','bili_auth_status','bili_auth_cancel'])].sort()); const result=await client.callTool({name:'bili_write_preview',arguments:{action:{kind:'dm.send',uid:'222',text:'hello'}}}); assert.equal(result.structuredContent.ok,true); if(!anonymous) assert.equal((await client.callTool({name:'bili_auth_status',arguments:{}})).structuredContent.data.authenticated,false); console.log(anonymous?'Explicit anonymous MCP configuration passed':'Built MCP stdio passed'); } finally {await client.close();}
`,
);
process.stdout.write(run(process.execPath, [probe], dirname(probe)));
await writeFile(config, JSON.stringify({ version: 1, stateDir: "./state" }));
process.stdout.write(run(process.execPath, [probe, "anonymous"], dirname(probe)));

// Redirect only these test processes' os.homedir() and network, without touching the user's home/account.
const testHome = join(work, "test-home");
const preload = join(work, "default-login-fixture.mjs");
await mkdir(testHome);
await writeFile(
  preload,
  `
import os from 'node:os';
import {syncBuiltinESMExports} from 'node:module';
os.homedir = () => ${JSON.stringify(testHome)};
syncBuiltinESMExports();
globalThis.fetch = async (input) => {
  const url = new URL(input);
  if(url.pathname.endsWith('/generate')) return Response.json({code:0,data:{url:'https://passport.bilibili.com/scan?qrcode_key=fixture',qrcode_key:'fixture'}});
  if(url.pathname.endsWith('/poll')) {
    if(process.env.BILI_SMOKE_WAIT === '1') return Response.json({code:0,data:{code:86101}});
    return new Response(JSON.stringify({code:0,data:{code:0}}),{headers:[['set-cookie','SESSDATA=fixture-session; Path=/'],['set-cookie','bili_jct=fixture-csrf; Path=/']]});
  }
  if(url.pathname.endsWith('/nav')) return Response.json({code:0,data:{isLogin:true,mid:123,uname:'fixture'}});
  throw new Error('Unexpected fixture request');
};
`,
);
const cliEntry = join(work, "node_modules/@bili-agent-kit/cli/dist/main.mjs");
const defaultLogin = JSON.parse(
  run(process.execPath, ["--import", preload, cliEntry, "auth.login"], work),
);
assert.deepEqual(defaultLogin.data, {
  authenticated: true,
  account: { uid: "123", name: "fixture" },
});
assert.equal(
  JSON.parse(await readFile(join(testHome, ".bili-agent-kit", "credentials.json"), "utf8"))
    .sessdata,
  "fixture-session",
);
await writeFile(
  probe,
  `
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const client = new Client({name:'default-smoke',version:'1'});
const waiting = process.argv[2] === 'waiting';
const transport = new StdioClientTransport({command:process.execPath,args:['--import',${JSON.stringify(preload)},${JSON.stringify(mcpEntry)}],env:{...process.env,BILI_SMOKE_WAIT:waiting?'1':'0'},stderr:'pipe'});
try {
  await client.connect(transport);
  const login = await client.callTool({name:'bili_auth_login',arguments:{}});
  if(waiting) {
    assert.equal(login.structuredContent.data.status,'waiting');
    assert.ok(login.content.some(item=>item.type==='image' && item.mimeType==='image/png'));
    await access(${JSON.stringify(join(testHome, ".bili-agent-kit", "credentials.json.lock"))});
  } else {
    assert.equal(login.structuredContent.data.authenticated,true);
    assert.equal(login.structuredContent.data.account.uid,'123');
  }
} finally { await client.close(); }
await assert.rejects(access(${JSON.stringify(join(testHome, ".bili-agent-kit", "credentials.json.lock"))}));
console.log(waiting?'MCP stdio close cancels pending login and releases lock':'Default CLI/MCP configuration and account sharing passed');
`,
);
process.stdout.write(run(process.execPath, [probe], dirname(probe)));
run(process.execPath, ["--import", preload, cliEntry, "auth.logout"], work);
process.stdout.write(run(process.execPath, [probe, "waiting"], dirname(probe)));
console.log(
  "Pack/install, binary JSON/exit codes, declarations, licenses and stdio checks passed.",
);
