import { expect, it } from "vite-plus/test";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileCredentials } from "../packages/core/src/credentials.js";
import { FileAuth } from "../packages/core/src/auth-runtime.js";
import { MemoryStore } from "../packages/core/src/state.js";
import { QrLogin } from "../packages/core/src/auth.js";
import { fakeClock, fakeCredentials, json } from "./helpers.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { digest } from "../packages/core/src/wbi.js";

async function fixture(responses: Response[]) {
  const dir = await mkdtemp(join(tmpdir(), "bili-auth-"));
  const credentials = new FileCredentials(join(dir, "credentials.json"));
  const store = new MemoryStore();
  const protocol = new QrLogin({
    clock: fakeClock(),
    fetch: async () => {
      const r = responses.shift();
      if (!r) throw new Error("unexpected");
      return r;
    },
  });
  return { dir, credentials, store, auth: new FileAuth(credentials, store, protocol) };
}
it("preserves credentials on failed update, rejects contention, and removes only local credentials", async () => {
  const { credentials, dir } = await fixture([]);
  expect(await credentials.read()).toBeUndefined();
  await credentials.update(async () => fakeCredentials);
  const before = await readFile(credentials.path, "utf8");
  await expect(
    credentials.update(async () => {
      throw new Error("failure");
    }),
  ).rejects.toThrow("failure");
  expect(await readFile(credentials.path, "utf8")).toBe(before);
  await credentials.update(async (old) => {
    await expect(credentials.update(async () => undefined)).rejects.toMatchObject({
      code: "STATE_BUSY",
    });
    return old;
  });
  await writeFile(join(dir, "state.json"), "keep");
  await credentials.update(async () => undefined);
  expect(await credentials.read()).toBeUndefined();
  expect(await readFile(join(dir, "state.json"), "utf8")).toBe("keep");
});
it("fails invalid credentials without replacing the original file and uses private permissions", async () => {
  const { credentials } = await fixture([]);
  await credentials.update(async () => fakeCredentials);
  if (process.platform !== "win32") expect((await stat(credentials.path)).mode & 0o777).toBe(0o600);
  else {
    const system = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
    const options = { windowsHide: true, timeout: 10000 };
    const { stdout } = await promisify(execFile)(
      join(system, "whoami.exe"),
      ["/user", "/fo", "csv", "/nh"],
      options,
    );
    const sid = stdout.match(/S-1-\d+(?:-\d+)+/)?.[0];
    expect(sid).toBeDefined();
    const aclPath = `${credentials.path}.acl`;
    await promisify(execFile)(
      join(system, "icacls.exe"),
      [credentials.path, "/save", aclPath, "/q"],
      options,
    );
    const sddl = (await readFile(aclPath, "utf16le")).split(/\r?\n/)[1];
    expect(sddl).toMatch(/^D:P(?:AI)?\(/);
    expect(sddl?.match(/\([^)]*\)/g)).toEqual([`(A;;FA;;;${sid})`]);
  }
  await writeFile(credentials.path, "{broken");
  await expect(credentials.update(async () => fakeCredentials)).rejects.toMatchObject({
    code: "AUTH_REQUIRED",
  });
  expect(await readFile(credentials.path, "utf8")).toBe("{broken");
});
it("preserves legacy state and old credentials when its expired session cannot be identified", async () => {
  const { credentials, store, auth } = await fixture([json({}, -101)]);
  await credentials.update(async () => fakeCredentials);
  await store.transaction((s) => {
    s.cursors[`${digest(fakeCredentials.sessdata)}:dm:222`] = {
      revision: 1,
      lastSeen: 50,
      lastKeys: [],
      pending: [],
    };
  });
  const before = await store.snapshot();
  await expect(
    auth.login({
      onQr: async () => {
        throw new Error("must not generate QR");
      },
    }),
  ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  expect(await store.snapshot()).toEqual(before);
  expect(await credentials.read()).toEqual(fakeCredentials);
});
it("does not replace old credentials if account state cannot be saved after QR success", async () => {
  const { credentials, auth } = await fixture([
    json({ url: "https://passport.bilibili.com/scan", qrcode_key: "key" }),
    new Response(JSON.stringify({ code: 0, data: { code: 0 } }), {
      headers: [
        ["set-cookie", "SESSDATA=new-session"],
        ["set-cookie", "bili_jct=new-csrf"],
      ],
    }),
    json({ isLogin: true, mid: 111 }),
  ]);
  await credentials.update(async () => fakeCredentials);
  const failingStore = {
    durable: true,
    snapshot: () => auth.store.snapshot(),
    transaction: async () => {
      throw new Error("disk failure");
    },
  };
  await expect(
    new FileAuth(credentials, failingStore, auth.protocol).login({ onQr: async () => {} }),
  ).rejects.toThrow("disk failure");
  expect(await credentials.read()).toEqual(fakeCredentials);
});
it("failed QR login retains old credentials; status does not expose them", async () => {
  const { credentials, auth } = await fixture([
    json({ url: "https://passport.bilibili.com/scan", qrcode_key: "key" }),
    json({ code: 86038 }),
    json({ isLogin: true, mid: 111, uname: "test" }),
  ]);
  await credentials.update(async () => fakeCredentials);
  await expect(auth.login({ onQr: async () => {} })).rejects.toMatchObject({
    code: "AUTH_REQUIRED",
  });
  expect(await credentials.read()).toEqual(fakeCredentials);
  expect(await auth.status()).toEqual({
    authenticated: true,
    account: { uid: "111", name: "test" },
  });
});
