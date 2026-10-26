import { expect, it } from "vite-plus/test";
import { setup, json } from "./helpers.js";
import { invoke } from "../packages/core/src/operations.js";
import { BiliKit } from "../packages/core/src/kit.js";

it("replays notification receipts after restart and advances only after ack", async () => {
  let second = false;
  const { kit, options } = await setup(() =>
    json({
      items: second
        ? [
            { id: "200", reply_time: 2, user: { mid: 222 }, item: { source_content: "hello" } },
            { id: "100", reply_time: 1 },
          ]
        : [{ id: "100", reply_time: 1 }],
      cursor: { is_end: true },
    }),
  );
  expect(await invoke(kit, "events_poll", { source: "reply" })).toMatchObject({
    ok: true,
    data: { baseline: true, event: null },
  });
  second = true;
  const next = await invoke(kit, "events_poll", { source: "reply" });
  expect(next).toMatchObject({ ok: true, data: { event: { message: { key: "200" } } } });
  expect(await invoke(new BiliKit(options), "events_poll", { source: "reply" })).toEqual(next);
  if (!next.ok) throw new Error("No event");
  const receipt = (next.data as { event: { receipt: string } }).event.receipt;
  expect(await invoke(kit, "events_ack", { source: "reply", receipt })).toMatchObject({ ok: true });
  expect(await invoke(kit, "events_poll", { source: "reply" })).toMatchObject({
    ok: true,
    data: { event: null },
  });
});

it("does not advance a notification cursor when pagination fails", async () => {
  let fail = false;
  const { kit, store } = await setup((url) =>
    fail && url.searchParams.has("id")
      ? json({}, -400)
      : json({
          items: [{ id: fail ? "300" : "200", reply_time: fail ? 3 : 2 }],
          cursor: { is_end: !fail, id: "200", time: 2 },
        }),
  );
  await invoke(kit, "events_poll", { source: "reply" });
  const before = (await store.snapshot()).events;
  fail = true;
  expect(await invoke(kit, "events_poll", { source: "reply" })).toMatchObject({ ok: false });
  expect((await store.snapshot()).events).toEqual(before);
});

it("delivers new comments with equal timestamps and does not replay older comments after deletion", async () => {
  let replies = [{ rpid: "100", mid: "222", ctime: 10, content: { message: "baseline" } }];
  const { kit } = await setup(() => json({ replies }));
  expect(await kit.events.peek({ source: "comments", oid: "42" })).toMatchObject({
    baseline: true,
    event: null,
  });
  replies = [
    { rpid: "101", mid: "222", ctime: 10, content: { message: "new" } },
    { rpid: "90", mid: "222", ctime: 9, content: { message: "old" } },
  ];
  const next = await kit.events.peek({ source: "comments", oid: "42" });
  expect(next.event?.message.key).toBe("101");
  await kit.events.ack({ source: "comments", oid: "42", receipt: next.event!.receipt });
  expect(await kit.events.peek({ source: "comments", oid: "42" })).toMatchObject({ event: null });
});
