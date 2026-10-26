import { expect, it } from "vite-plus/test";
import { BiliKit } from "../packages/core/src/kit.js";
import { setup, json } from "./helpers.js";

const credentials = {
  clientId: "app",
  appSecret: "secret",
  accessToken: "token",
  uid: "111",
  scopes: ["ARC_DATA", "LIVE_ROOM_DATA"],
};
it("enforces ARC_DATA and returns the documented aggregate data", async () => {
  const ctx = await setup(() => json({ inc_click: 10 }));
  const kit = new BiliKit({
    ...ctx.options,
    openPlatform: { credentials: async () => credentials },
  });
  expect(await kit.open.call("open_video_stats", {})).toEqual({ inc_click: 10 });
  expect(ctx.calls.at(-1)!.url.pathname).toBe("/arcopen/fn/data/arc/inc-stats");
  expect(new Headers(ctx.calls.at(-1)!.init.headers).has("cookie")).toBe(false);
});
it("counts live service requests separately from content write budgets", async () => {
  const ctx = await setup(() => json({}));
  const kit = new BiliKit({
    ...ctx.options,
    openPlatform: { credentials: async () => credentials },
  });
  const session = await kit.open.session("LIVE_ROOM_DATA");
  for (let i = 0; i < 15; i++)
    await kit.open.request(
      session,
      "/arcopen/fn/live/room/ws-heartbeat",
      "POST",
      { conn_id: "connection" },
      { client_id: "app" },
    );
  const count = (await ctx.store.snapshot()).traffic.accounts["uid:111"]!;
  expect(count.writeHour).toBe(0);
  expect(count.readHour).toBe(0);
  expect(count.serviceHour).toBe(15);
});
