import { expect, it } from "vite-plus/test";
import { setup, json } from "./helpers.js";
import { BiliKit } from "../packages/core/src/kit.js";

const action = { kind: "dm.send", uid: "222", text: "hello" } as const;
it("dry run makes no network call and disabled writes cannot execute", async () => {
  const { kit, calls } = await setup(undefined, { writesEnabled: false });
  expect(kit.writes.preview(action).target).toBe("dm:222");
  expect(calls).toHaveLength(0);
  await expect(kit.writes.prepare(action, "key1")).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("requires trusted approval and rejects changed idempotency content", async () => {
  const { kit, calls } = await setup();
  const draft = await kit.writes.prepare(action, "key1");
  await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  await expect(kit.writes.prepare({ ...action, text: "changed" }, "key1")).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await expect(kit.admin.approve(draft.id, "wrong-digest", "operator")).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await kit.admin.approve(draft.id, draft.digest, "operator");
  await kit.writes.execute(draft.id);
  await kit.writes.execute(draft.id);
  expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
});
it("persists unknown outcomes across restart and never automatically resends", async () => {
  const { kit, options, calls } = await setup(() => {
    throw new Error("secret upstream failure");
  });
  const draft = await kit.writes.prepare(action, "key1");
  await kit.admin.approve(draft.id, draft.digest, "operator");
  await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "UNKNOWN_OUTCOME" });
  await expect(new BiliKit(options).writes.execute(draft.id)).rejects.toMatchObject({
    code: "UNKNOWN_OUTCOME",
  });
  expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
});
it("concurrent execution reserves only one send", async () => {
  const { kit, options, calls } = await setup(() => json({ msg_key: "1" }));
  const draft = await kit.writes.prepare(action, "key1");
  await kit.admin.approve(draft.id, draft.digest, "operator");
  await Promise.allSettled([
    kit.writes.execute(draft.id),
    new BiliKit(options).writes.execute(draft.id),
  ]);
  expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
});
it("rechecks current policy, account and approval expiry before sending", async () => {
  const { kit, options, clock } = await setup();
  const draft = await kit.writes.prepare(action, "key1");
  await kit.admin.approve(draft.id, draft.digest, "operator");
  await expect(
    new BiliKit({ ...options, policy: { ...options.policy, allowedTargets: [] } }).writes.execute(
      draft.id,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    new BiliKit({
      ...options,
      credentials: async () => ({ sessdata: "other", bili_jct: "other" }),
    }).writes.execute(draft.id),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  clock.advance(3600001);
  await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
});
