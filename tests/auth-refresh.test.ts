import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vite-plus/test";
import { FileAuth } from "../packages/core/src/auth-runtime.js";
import { FileCredentials } from "../packages/core/src/credentials.js";
import { FileStore } from "../packages/core/src/state.js";
import { QrLogin } from "../packages/core/src/auth.js";
import { fakeClock, json } from "./helpers.js";

async function fixture(mode: "confirm-fails" | "rotate-unknown" | "wrong-uid") {
  const root = await mkdtemp(join(tmpdir(), "bili-refresh-")),
    credentials = new FileCredentials(join(root, "credentials.json"));
  await credentials.update(async () => ({
    sessdata: "old-session",
    bili_jct: "old-csrf",
    refresh_token: "old-refresh",
  }));
  const calls: string[] = [];
  let confirmations = 0;
  const protocol = new QrLogin({
    clock: fakeClock(),
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input),
        path = url.pathname;
      calls.push(path);
      const cookie = new Headers(init?.headers).get("cookie") ?? "";
      if (path.endsWith("/nav"))
        return json({
          isLogin: true,
          mid: mode === "wrong-uid" && cookie.includes("new-session") ? 222 : 111,
        });
      if (path.endsWith("/info")) return json({ refresh: true, timestamp: 1702204169000 });
      if (path.startsWith("/correspond/1/"))
        return new Response('<html><div id="1-name">challenge</div></html>');
      if (path.endsWith("/cookie/refresh")) {
        if (mode === "rotate-unknown") throw Error("lost response");
        return new Response(JSON.stringify({ code: 0, data: { refresh_token: "new-refresh" } }), {
          headers: [
            ["content-type", "application/json"],
            ["set-cookie", "SESSDATA=new-session; Path=/"],
            ["set-cookie", "bili_jct=new-csrf; Path=/"],
          ],
        });
      }
      if (path.endsWith("/confirm/refresh")) {
        expect((await credentials.read())?.sessdata).toBe("new-session");
        expect(new URLSearchParams(init?.body as string).get("refresh_token")).toBe("old-refresh");
        if (mode === "confirm-fails" && ++confirmations === 1) throw Error("lost confirm");
        return json({});
      }
      throw Error("unexpected request");
    },
  });
  const store = new FileStore(root),
    auth = new FileAuth(credentials, store, protocol);
  return { credentials, store, auth, calls };
}
it("persists new credentials before confirmation and resumes without rotating again", async () => {
  const { credentials, store, auth, calls } = await fixture("confirm-fails");
  await expect(auth.refresh()).rejects.toMatchObject({ code: "UNKNOWN_OUTCOME" });
  expect((await credentials.read())?.refresh_token).toBe("new-refresh");
  await expect(auth.refresh()).resolves.toEqual({ refreshed: true, confirmed: true });
  expect(calls.filter((p) => p.endsWith("/cookie/refresh"))).toHaveLength(1);
  expect(Object.values((await store.snapshot()).identities)).toEqual(["111", "111"]);
  await expect(readFile(`${credentials.path}.refresh.json`)).rejects.toMatchObject({
    code: "ENOENT",
  });
});
it("blocks replay when cookie rotation itself has an unknown outcome", async () => {
  const { credentials, auth, calls } = await fixture("rotate-unknown");
  await expect(auth.refresh()).rejects.toMatchObject({ code: "UNKNOWN_OUTCOME" });
  const count = calls.length;
  await expect(auth.refresh()).rejects.toMatchObject({ code: "UNKNOWN_OUTCOME" });
  expect(calls).toHaveLength(count);
  expect((await credentials.read())?.sessdata).toBe("old-session");
});
it("preserves old credentials when refreshed identity does not match", async () => {
  const { credentials, auth, calls } = await fixture("wrong-uid");
  await expect(auth.refresh()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  expect((await credentials.read())?.sessdata).toBe("old-session");
  expect(calls.some((p) => p.endsWith("/confirm/refresh"))).toBe(false);
});
