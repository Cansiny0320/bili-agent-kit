import { expect, it } from "vite-plus/test";
import { QrLogin } from "../packages/core/src/auth.js";
import { fakeClock, json, fakeCredentials } from "./helpers.js";

function fixture(responses: Response[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const clock = fakeClock();
  const login = new QrLogin({
    clock,
    fetch: async (url, init) => {
      calls.push({
        url: url instanceof Request ? url.url : String(url),
        ...(init ? { init } : {}),
      });
      const response = responses.shift();
      if (!response) throw new Error("unexpected request");
      return response;
    },
  });
  return { login, clock, calls };
}
const generated = () =>
  json({
    url: "https://account.bilibili.com/h5/account-h5/auth/scan-web?test=1",
    qrcode_key: "fixture-key",
  });
const success = () =>
  new Response(
    JSON.stringify({
      code: 0,
      data: {
        code: 0,
        url: "https://example.invalid/?secret=do-not-return",
        refresh_token: "do-not-return",
      },
    }),
    {
      headers: [
        ["set-cookie", `SESSDATA=${fakeCredentials.sessdata}; Path=/; HttpOnly`],
        ["set-cookie", `bili_jct=${fakeCredentials.bili_jct}; Path=/`],
      ],
    },
  );
it("handles waiting, scanned and verified success with bounded polling and no redirect secrets", async () => {
  const { login, calls, clock } = fixture([
    generated(),
    json({ code: 86101 }),
    json({ code: 86090 }),
    success(),
    json({ isLogin: true, mid: 111, uname: "fixture" }),
  ]);
  const qr = await login.generate();
  const start = clock.now();
  expect(await login.poll(qr)).toEqual({ status: "waiting" });
  expect(await login.poll(qr)).toEqual({ status: "scanned" });
  const result = await login.poll(qr);
  expect(result).toEqual({
    status: "success",
    account: { uid: "111", name: "fixture" },
    credentials: fakeCredentials,
  });
  expect(clock.now() - start).toBeGreaterThanOrEqual(6000);
  expect(JSON.stringify(result)).not.toContain("do-not-return");
  expect(calls.every((c) => c.init?.redirect === "error")).toBe(true);
});
it("rejects missing cookies, unverified login, foreign QR URL, and unknown status without leaking upstream", async () => {
  const missing = fixture([generated(), json({ code: 0, refresh_token: "secret" })]);
  await expect(missing.login.poll(await missing.login.generate())).rejects.toMatchObject({
    code: "AUTH_REQUIRED",
  });
  const invalid = fixture([generated(), success(), json({ isLogin: false })]);
  await expect(invalid.login.poll(await invalid.login.generate())).rejects.toMatchObject({
    code: "AUTH_REQUIRED",
  });
  const foreign = fixture([json({ url: "https://evil.invalid/", qrcode_key: "key" })]);
  await expect(foreign.login.generate()).rejects.toMatchObject({ code: "UPSTREAM" });
  const unknown = fixture([generated(), json({ code: 999, message: "secret" })]);
  await expect(unknown.login.poll(await unknown.login.generate())).rejects.toMatchObject({
    code: "UPSTREAM",
  });
});
it("expires and cancels without further requests", async () => {
  const { login, calls, clock } = fixture([generated()]);
  const qr = await login.generate();
  clock.advance(180001);
  expect(await login.poll(qr)).toEqual({ status: "expired" });
  expect(calls).toHaveLength(1);
  const cancel = new AbortController();
  cancel.abort();
  await expect(login.generate(cancel.signal)).rejects.toMatchObject({ code: "CANCELLED" });
  expect(calls).toHaveLength(1);
});
it("sanitizes network errors and echoed credentials, and aborts an in-flight request", async () => {
  const failed = new QrLogin({
    fetch: async () => {
      throw new Error(fakeCredentials.sessdata);
    },
  });
  await expect(failed.generate()).rejects.toMatchObject({
    code: "NETWORK",
    message: "Login request failed.",
  });
  const echoed = fixture([json({ isLogin: true, mid: 111, uname: fakeCredentials.sessdata })]);
  expect((await echoed.login.verify(fakeCredentials)).name).toBe("[redacted]");
  const controller = new AbortController();
  const pending = new QrLogin({
    fetch: async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        controller.abort();
      }),
  });
  await expect(pending.generate(controller.signal)).rejects.toMatchObject({ code: "CANCELLED" });
});
