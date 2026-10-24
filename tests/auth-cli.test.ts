import { expect, it } from "vite-plus/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../packages/cli/src/index.js";
import { FileAuth, FileCredentials, MemoryStore, QrLogin } from "../packages/core/src/index.js";
import { fakeClock, json } from "./helpers.js";

it("CLI renders QR only through stderr, writes PNG and returns sanitized success", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bili-cli-auth-"));
  const png = join(dir, "qr.png");
  const replies = [
    json({ url: "https://passport.bilibili.com/scan?qrcode_key=key", qrcode_key: "key" }),
    json({ code: 86090 }),
    new Response(JSON.stringify({ code: 0, data: { code: 0, refresh_token: "private-refresh" } }), {
      headers: [
        ["set-cookie", "SESSDATA=private-session; Path=/"],
        ["set-cookie", "bili_jct=private-csrf; Path=/"],
      ],
    }),
    json({ isLogin: true, mid: 111, uname: "test" }),
  ];
  const file = new FileCredentials(join(dir, "credentials.json"));
  const auth = new FileAuth(
    file,
    new MemoryStore(),
    new QrLogin({ clock: fakeClock(), fetch: async () => replies.shift()! }),
  );
  let stderr = "";
  const result = await runCli(
    ["--config", "unused", "auth.login", JSON.stringify({ png })],
    async () => "",
    undefined,
    {
      load: async () => auth,
      stderr: (text) => {
        stderr += text;
      },
    },
  );
  expect(result).toEqual({
    version: 1,
    ok: true,
    data: { authenticated: true, account: { uid: "111", name: "test" } },
  });
  expect(stderr).toContain("确认");
  expect(JSON.stringify(result) + stderr).not.toMatch(
    /private-session|private-csrf|private-refresh/,
  );
  expect((await readFile(png)).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect((await file.read())?.sessdata).toBe("private-session");
});
it("rejects unexpected auth inputs before loading and never overwrites an existing PNG", async () => {
  let loads = 0;
  const result = await runCli(
    ["--config", "unused", "auth.logout", '{"all":true}'],
    async () => "",
    undefined,
    {
      load: async () => {
        loads++;
        throw new Error("not called");
      },
    },
  );
  expect(result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  expect(loads).toBe(0);
  const dir = await mkdtemp(join(tmpdir(), "bili-cli-existing-"));
  const png = join(dir, "existing.png");
  await writeFile(png, "keep");
  const auth = new FileAuth(
    new FileCredentials(join(dir, "credentials.json")),
    new MemoryStore(),
    new QrLogin({
      clock: fakeClock(),
      fetch: async () => json({ url: "https://passport.bilibili.com/scan", qrcode_key: "key" }),
    }),
  );
  const rejected = await runCli(
    ["--config", "unused", "auth.login", JSON.stringify({ png })],
    async () => "",
    undefined,
    { load: async () => auth, stderr: () => {} },
  );
  expect(rejected.ok).toBe(false);
  expect(await readFile(png, "utf8")).toBe("keep");
});
