import { createHash } from "node:crypto";
import { expect, it } from "vite-plus/test";
import { BiliKit } from "../packages/core/src/kit.js";
import { setup } from "./helpers.js";
const credentials = {
  clientId: "app",
  appSecret: "secret",
  accessToken: "token",
  uid: "111",
  openId: "user-open-id",
  scopes: ["USER_INFO"],
};
const sign = (body: string) => createHash("sha1").update("secret").update(body).digest("hex");
it("verifies raw bytes, acknowledges challenges and persists each delivery once", async () => {
  const ctx = await setup();
  const options = { ...ctx.options, openPlatform: { credentials: async () => credentials } };
  const kit = new BiliKit(options);
  const challenge = JSON.stringify({
    event: "verify_webhooks",
    content: { data: 123 },
    timestamp: "2026-10-26 12:00:00",
  });
  expect(await kit.openEvents.receiveWebhook(challenge, sign(challenge))).toEqual({ data: 123 });
  const body = JSON.stringify({
    event: "video_open",
    content: {
      client_id: "app",
      openid: "user-open-id",
      resource_id: "BV1xx411c7mD",
      state: 0,
      state_desc: "开放浏览",
    },
    timestamp: "2026-10-26 12:00:00",
  });
  await expect(kit.openEvents.receiveWebhook(body + " ", sign(body))).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(await kit.openEvents.receiveWebhook(body, sign(body))).toMatchObject({
    accepted: true,
    duplicate: false,
  });
  expect(await kit.openEvents.receiveWebhook(body, sign(body))).toMatchObject({ duplicate: true });
  const next = await kit.openEvents.peek({ source: "webhook" });
  expect(next.event?.event).toMatchObject({ event: "video_open" });
  expect(await new BiliKit(options).openEvents.peek({ source: "webhook" })).toEqual(next);
  await kit.openEvents.ack({ source: "webhook", receipt: next.event!.receipt });
  expect(await kit.openEvents.peek({ source: "webhook" })).toEqual({ event: null });
  expect(await kit.openEvents.receiveWebhook(body, sign(body))).toMatchObject({ duplicate: true });
});
it("rejects callbacks for another user even when signed by the same application", async () => {
  const ctx = await setup();
  const kit = new BiliKit({
    ...ctx.options,
    openPlatform: { credentials: async () => credentials },
  });
  const body = JSON.stringify({
    event: "video_fail",
    content: { client_id: "app", openid: "another-user" },
    timestamp: "2026-10-26 12:00:00",
  });
  await expect(kit.openEvents.receiveWebhook(body, sign(body))).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect((await ctx.store.snapshot()).openEvents).toEqual({});
});
