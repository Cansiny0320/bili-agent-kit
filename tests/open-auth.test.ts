import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { OpenAuth } from "../packages/core/src/open-auth.js";
import { Traffic } from "../packages/core/src/traffic.js";
import { MemoryStore } from "../packages/core/src/state.js";
import { fakeClock, json } from "./helpers.js";

async function fixture(fetcher: typeof fetch) {
  const dir = await mkdtemp(join(tmpdir(), "bili-oauth-")),
    file = join(dir, "credentials.json"),
    clock = fakeClock();
  await writeFile(
    file,
    JSON.stringify({
      clientId: "app",
      appSecret: "secret",
      uid: "111",
      accessToken: "old-token",
      refreshToken: "old-refresh",
      scopes: ["ARC_DATA"],
      expiresAt: clock.now() + 600000,
    }),
  );
  return { auth: new OpenAuth(file, new Traffic(new MemoryStore(), clock, fetcher)), file, clock };
}
it("uses one-time state and UTC absolute expiry without returning tokens", async () => {
  let requests = 0;
  const ctx = await fixture(async (input, init) => {
    requests++;
    const url = new URL(input instanceof Request ? input.url : input);
    expect(url.searchParams.get("grant_type")).toBe("authorization_code");
    expect(init?.body).toBeUndefined();
    return json({
      access_token: "new-token",
      refresh_token: "new-refresh",
      expires_in: 1702204769,
      scopes: ["ARC_DATA"],
    });
  });
  const flow = await ctx.auth.begin({ redirectUrl: "https://example.com/oauth" });
  const state = new URL(flow.url).searchParams.get("state")!;
  await expect(ctx.auth.exchange({ code: "code", state: "invalid" })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  const result = await ctx.auth.exchange({ code: "code", state });
  expect(JSON.stringify(result)).not.toContain("new-token");
  expect(JSON.parse(await readFile(ctx.file, "utf8")).expiresAt).toBe(1702204769000);
  await expect(ctx.auth.exchange({ code: "code", state })).rejects.toMatchObject({
    code: "AUTH_REQUIRED",
  });
  expect(requests).toBe(1);
});
it("does not reuse a refresh token after an uncertain network outcome", async () => {
  let calls = 0;
  const ctx = await fixture(async () => {
    calls++;
    throw Error("lost response");
  });
  await expect(ctx.auth.refresh()).rejects.toMatchObject({ code: "UNKNOWN_OUTCOME" });
  await expect(ctx.auth.refresh()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  expect(calls).toBe(1);
  expect(JSON.parse(await readFile(ctx.file, "utf8")).refreshPending).toBe(true);
});
it("serializes refresh and preserves scopes absent from the refresh response", async () => {
  let release: (() => void) | undefined;
  const ctx = await fixture(async () => {
    await new Promise<void>((r) => {
      release = r;
    });
    return json({ access_token: "fresh", refresh_token: "rotated", expires_in: 1702204769 });
  });
  const first = ctx.auth.refresh();
  for (let i = 0; !release && i < 100; i++) await new Promise((r) => setTimeout(r, 2));
  await expect(ctx.auth.refresh()).rejects.toMatchObject({ code: "STATE_BUSY" });
  release!();
  await first;
  expect(JSON.parse(await readFile(ctx.file, "utf8"))).toMatchObject({
    refreshToken: "rotated",
    scopes: ["ARC_DATA"],
    refreshPending: false,
  });
});
