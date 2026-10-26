import { expect, it } from "vite-plus/test";
import { mkdtemp, access, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  BiliKit,
  FileAuth,
  FileCredentials,
  MemoryStore,
  QrLogin,
  KitError,
  type QrResult,
} from "../packages/core/src/index.js";
import { createMcpServer } from "../packages/mcp/src/index.js";

async function fixture(existing = false, valid = true) {
  const dir = await mkdtemp(join(tmpdir(), "bili-mcp-auth-"));
  const credentials = new FileCredentials(join(dir, "credentials.json"));
  if (existing)
    await credentials.update(async () => ({ sessdata: "old-secret", bili_jct: "old-csrf" }));
  let resolvePoll: (result: QrResult) => void = () => {};
  let rejectPoll: (error: Error) => void = () => {};
  let generates = 0;
  class Protocol extends QrLogin {
    override async generate() {
      generates++;
      return {
        url: "https://passport.bilibili.com/scan?qrcode_key=secret-key",
        key: "secret-key",
        expiresAt: Date.now() + 180000,
      };
    }
    override async verify() {
      if (!valid) throw new KitError("AUTH_REQUIRED", "Expired.");
      return { uid: "123", name: "fixture" };
    }
    override async poll(_qr: unknown, signal?: AbortSignal): Promise<QrResult> {
      return new Promise((resolve, reject) => {
        resolvePoll = resolve;
        rejectPoll = reject;
        const abort = () => reject(new KitError("CANCELLED", "Login cancelled."));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
    }
  }
  const auth = new FileAuth(credentials, new MemoryStore(), new Protocol());
  const server = createMcpServer(new BiliKit({ store: new MemoryStore() }), { auth });
  const client = new Client({ name: "auth-test", version: "1" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  const call = (name: string) => client.callTool({ name: `bili_auth_${name}`, arguments: {} });
  return {
    auth,
    credentials,
    server,
    client,
    call,
    resolvePoll: (result: QrResult) => resolvePoll(result),
    rejectPoll: (error: Error) => rejectPoll(error),
    generates: () => generates,
    setValid: (value: boolean) => {
      valid = value;
    },
    close: async () => {
      await client.close();
      await server.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

it("returns an MCP QR image promptly, reuses pending login, and saves only verified credentials", async () => {
  const f = await fixture();
  try {
    const result = await f.call("login");
    expect(result.structuredContent).toMatchObject({ ok: true, data: { status: "waiting" } });
    expect(result.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "image", mimeType: "image/png" })]),
    );
    expect(JSON.stringify(result.structuredContent)).not.toMatch(/secret-key|data:image|base64/);
    await f.call("login");
    expect(f.generates()).toBe(1);
    f.resolvePoll({
      status: "success",
      account: { uid: "123", name: "fixture" },
      credentials: { sessdata: "new-secret", bili_jct: "new-csrf" },
    });
    await expect
      .poll(async () => (await f.call("status")).structuredContent)
      .toMatchObject({ ok: true, data: { authenticated: true, account: { uid: "123" } } });
    expect((await f.credentials.read())?.sessdata).toBe("new-secret");
    expect(JSON.stringify(await f.call("status"))).not.toMatch(/new-secret|new-csrf/);
    const names = (await f.client.listTools()).tools.map((tool) => tool.name);
    expect(names.filter((name) => name.startsWith("bili_auth_"))).toEqual([
      "bili_auth_login",
      "bili_auth_status",
      "bili_auth_cancel",
    ]);
    expect(names.some((name) => /approve|logout|refresh|admin/.test(name))).toBe(false);
  } finally {
    await f.close();
  }
});

it("keeps a valid login without creating another QR challenge", async () => {
  const f = await fixture(true);
  try {
    expect((await f.call("login")).structuredContent).toMatchObject({
      ok: true,
      data: { authenticated: true, account: { uid: "123" } },
    });
    expect(f.generates()).toBe(0);
    expect((await f.credentials.read())?.sessdata).toBe("old-secret");
  } finally {
    await f.close();
  }
});

it("cancels only the pending login, releases its lock and permits another attempt", async () => {
  const f = await fixture();
  try {
    await f.call("login");
    expect((await f.call("cancel")).structuredContent).toMatchObject({
      ok: true,
      data: { status: "cancelled" },
    });
    await expect(access(`${f.credentials.path}.lock`)).rejects.toThrow();
    expect(await f.credentials.read()).toBeUndefined();
    await f.call("login");
    expect(f.generates()).toBe(2);
    await f.server.close();
    await expect(access(`${f.credentials.path}.lock`)).rejects.toThrow();
  } finally {
    await f.close();
  }
});

it("reports expired challenges without retaining the QR image", async () => {
  const f = await fixture(true, false);
  try {
    await f.call("login");
    f.resolvePoll({ status: "expired" });
    await expect
      .poll(async () => (await f.call("status")).structuredContent)
      .toMatchObject({ ok: false, error: { code: "AUTH_REQUIRED" } });
    expect((await f.call("status")).content).toHaveLength(1);
    await expect(access(`${f.credentials.path}.lock`)).rejects.toThrow();
    expect((await f.credentials.read())?.sessdata).toBe("old-secret");
    // A later login from CLI must supersede this connection's expired challenge.
    await f.credentials.update(async () => ({ sessdata: "cli-secret", bili_jct: "cli-csrf" }));
    f.setValid(true);
    expect((await f.call("status")).structuredContent).toMatchObject({
      ok: true,
      data: { authenticated: true },
    });
  } finally {
    await f.close();
  }
});

it("sanitizes unexpected login failures and keeps previous credentials", async () => {
  const f = await fixture(true, false);
  try {
    await f.call("login");
    f.rejectPoll(new Error("private-session private-csrf"));
    await expect
      .poll(async () => (await f.call("status")).structuredContent)
      .toMatchObject({ ok: false, error: { code: "UNAVAILABLE" } });
    expect(JSON.stringify(await f.call("status"))).not.toMatch(/private-session|private-csrf/);
    expect((await f.credentials.read())?.sessdata).toBe("old-secret");
  } finally {
    await f.close();
  }
});
