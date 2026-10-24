import { expect, it } from "vite-plus/test";
import { setup, json } from "./helpers.js";
import { BiliKit } from "../packages/core/src/kit.js";
const row = (seq: string, ts = 1000, sender = "222") => ({
  msg_seqno: seq,
  msg_key: seq,
  timestamp: ts,
  sender_uid: sender,
  content: JSON.stringify({ content: `message ${seq}` }),
});
it("baseline skips history, same-second overlap deduplicates and pending receipts survive restarts", async () => {
  let newer = false;
  const { kit, calls, options } = await setup((url) => {
    if (!newer) return json({ messages: [row("1")], has_more: 0 });
    return url.searchParams.get("begin_seqno") === "0"
      ? json({ messages: [row("4", 1001, "111"), row("3"), row("2")], has_more: 1 })
      : json({ messages: [row("2"), row("1")], has_more: 0 });
  });
  expect(await kit.dm.peek({ uid: "222" })).toEqual({ baseline: true, event: null });
  newer = true;
  const first = await kit.dm.peek({ uid: "222" });
  expect(first.event?.message.key).toBe("2");
  const requests = calls.length;
  const restarted = new BiliKit(options);
  expect(await restarted.dm.peek({ uid: "222" })).toEqual(first);
  await expect(
    restarted.dm.ack({ uid: "222", receipt: "00000000-0000-4000-8000-000000000000" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await restarted.dm.ack({ uid: "222", receipt: first.event!.receipt });
  const second = await restarted.dm.peek({ uid: "222" });
  expect(second.event?.message.key).toBe("3");
  expect(calls).toHaveLength(requests);
  await restarted.dm.ack({ uid: "222", receipt: second.event!.receipt });
  expect((await restarted.dm.peek({ uid: "222" })).event).toBeNull();
});
it("partial pagination failure preserves the whole cursor", async () => {
  let newer = false;
  const { kit, store } = await setup((url) =>
    !newer
      ? json({ messages: [row("1", 900)], has_more: 0 })
      : url.searchParams.get("begin_seqno") === "0"
        ? json({ messages: [row("3"), row("2")], has_more: 1 })
        : json({}, -500),
  );
  await kit.dm.peek({ uid: "222" });
  const before = (await store.snapshot()).cursors;
  newer = true;
  await expect(kit.dm.peek({ uid: "222" })).rejects.toMatchObject({ code: "UPSTREAM" });
  expect((await store.snapshot()).cursors).toEqual(before);
});
it("non-progressing pagination and unsafe numeric IDs fail without skipping messages", async () => {
  let newer = false;
  const { kit, store } = await setup(() =>
    json({ messages: [row(newer ? "3" : "1", newer ? 1000 : 900)], has_more: newer ? 1 : 0 }),
  );
  await kit.dm.peek({ uid: "222" });
  const before = (await store.snapshot()).cursors;
  newer = true;
  await expect(kit.dm.peek({ uid: "222" })).rejects.toMatchObject({ code: "UPSTREAM" });
  expect((await store.snapshot()).cursors).toEqual(before);
  const invalid = await setup(() =>
    json({ messages: [{ ...row("1"), msg_key: 1e30 }], has_more: 0 }),
  );
  await expect(invalid.kit.dm.peek({ uid: "222" })).rejects.toMatchObject({ code: "UPSTREAM" });
});
