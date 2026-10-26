import { expect, it } from "vite-plus/test";
import { json, setup } from "./helpers.js";
import { BiliKit } from "../packages/core/src/kit.js";
import { MemoryStore } from "../packages/core/src/state.js";

it("detects an old video newly added to a collection and replays until acknowledged", async () => {
  let archives = [{ aid: 2, pubdate: 200, title: "baseline" }];
  const ctx = await setup(() => json({ archives, page: { total: archives.length } }));
  const kit = new BiliKit({ ...ctx.options, credentials: async () => undefined });
  const input = { source: "collection" as const, uid: "1", seasonId: "10" };
  expect(await kit.events.peek(input)).toMatchObject({ baseline: true, event: null });
  archives = [{ aid: 1, pubdate: 100, title: "old but newly added" }, ...archives];
  const next = await kit.events.peek(input);
  expect(next.event?.message.key).toBe("1");
  expect(next.event?.message.data).toMatchObject({ publishedAt: 100 });
  expect(await kit.events.peek(input)).toEqual(next);
  await kit.events.ack({ ...input, receipt: next.event!.receipt });
  expect(await kit.events.peek(input)).toMatchObject({ event: null });
});

it("does not create or advance a baseline for incomplete or duplicate pages", async () => {
  const ctx = await setup(() =>
    json({
      archives: Array.from({ length: 100 }, (_, i) => ({ aid: i + 1, pubdate: i })),
      page: { total: 101 },
    }),
  );
  await expect(
    ctx.kit.events.peek({ source: "series", uid: "1", seriesId: "10", maxPages: 1 }),
  ).rejects.toMatchObject({ code: "UPSTREAM" });
  expect((await ctx.store.snapshot()).events).toEqual({});
  await expect(
    ctx.kit.events.peek({ source: "series", uid: "1", seriesId: "10", maxPages: 2 }),
  ).rejects.toMatchObject({ code: "UPSTREAM" });
  expect((await ctx.store.snapshot()).events).toEqual({});
});

it("isolates anonymous and authenticated collection cursors", async () => {
  const ctx = await setup(() => json({ archives: [], page: { total: 0 } }));
  const store = new MemoryStore();
  const anonymous = new BiliKit({ ...ctx.options, store, credentials: async () => undefined });
  const input = { source: "series" as const, uid: "1", seriesId: "10" };
  expect(await anonymous.events.peek(input)).toMatchObject({ baseline: true });
  expect(await new BiliKit({ ...ctx.options, store }).events.peek(input)).toMatchObject({
    baseline: true,
  });
  expect(Object.keys((await store.snapshot()).events)).toHaveLength(2);
});
