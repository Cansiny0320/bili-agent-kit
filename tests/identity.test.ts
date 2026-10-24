import { expect, it } from "vite-plus/test";
import { MemoryStore } from "../packages/core/src/state.js";
import { bindIdentity } from "../packages/core/src/identity.js";
import { digest } from "../packages/core/src/wbi.js";
import { setup } from "./helpers.js";
import { BiliKit } from "../packages/core/src/kit.js";

it("migrates legacy budgets, pauses and cursors once and preserves same-UID budgets", async () => {
  const store = new MemoryStore();
  const old = digest("old");
  const next = digest("new");
  await store.transaction((s) => {
    s.traffic.accounts[old] = {
      hourAt: 100,
      dayAt: 100,
      readHour: 8,
      readDay: 10,
      writeHour: 2,
      writeDay: 3,
      lastWrite: 90,
    };
    s.traffic.manual[old] = true;
    s.cursors[`${old}:dm:222`] = { revision: 1, lastSeen: 50, lastKeys: ["x"], pending: [] };
  });
  await bindIdentity(store, old, "111");
  await bindIdentity(store, old, "111");
  await bindIdentity(store, next, "111");
  const s = await store.snapshot();
  expect(s.traffic.accounts["uid:111"]).toMatchObject({ readDay: 10, writeDay: 3 });
  expect(s.traffic.manual["uid:111"]).toBe(true);
  expect(s.cursors["uid:111:dm:222"]?.lastSeen).toBe(50);
  expect(s.identities[next]).toBe("111");
});
it("does not mutate state when old and new cursors conflict or identity changes", async () => {
  const store = new MemoryStore();
  const old = digest("old");
  await store.transaction((s) => {
    for (const k of [old, "uid:111"])
      s.cursors[`${k}:dm:222`] = { revision: 1, lastSeen: 50, lastKeys: [], pending: [] };
  });
  const before = await store.snapshot();
  await expect(bindIdentity(store, old, "111")).rejects.toMatchObject({ code: "STATE_INVALID" });
  expect(await store.snapshot()).toEqual(before);
});
it("rejects old drafts after same-account re-login while retaining account counters", async () => {
  const { kit, options, store } = await setup();
  const draft = await kit.writes.prepare({ kind: "dm.send", uid: "222", text: "hello" }, "old");
  await kit.admin.approve(draft.id, draft.digest, "operator");
  const changed = new BiliKit({
    ...options,
    credentials: async () => ({ sessdata: "new-session", bili_jct: "new-csrf" }),
  });
  await expect(changed.writes.execute(draft.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await store.snapshot()).traffic.accounts["uid:111"]).toBeDefined();
});
it("keeps accounts isolated and rejects reassignment of a verified fingerprint", async () => {
  const store = new MemoryStore();
  const first = digest("first");
  const second = digest("second");
  await bindIdentity(store, first, "111");
  await store.transaction((s) => {
    s.cursors["uid:111:dm:222"] = { revision: 1, lastSeen: 5, lastKeys: [], pending: [] };
  });
  await bindIdentity(store, second, "333");
  await expect(bindIdentity(store, first, "333")).rejects.toMatchObject({ code: "STATE_INVALID" });
  const s = await store.snapshot();
  expect(s.identities[first]).toBe("111");
  expect(s.cursors["uid:333:dm:222"]).toBeUndefined();
  expect(s.cursors["uid:111:dm:222"]?.lastSeen).toBe(5);
});
it("waits for live requests, recovers expired leases and incorporates a concurrent legacy reservation", async () => {
  const store = new MemoryStore();
  const key = digest("session");
  await store.transaction((s) => {
    s.traffic.active = { token: "crashed", until: 200 };
  });
  await expect(bindIdentity(store, key, "111", 100)).rejects.toMatchObject({ code: "STATE_BUSY" });
  await bindIdentity(store, key, "111", 201);
  await store.transaction((s) => {
    s.traffic.accounts[key] = {
      hourAt: 201,
      dayAt: 201,
      readHour: 1,
      readDay: 1,
      writeHour: 0,
      writeDay: 0,
      lastWrite: 0,
    };
  });
  await bindIdentity(store, key, "111", 202);
  const s = await store.snapshot();
  expect(s.traffic.active).toBeUndefined();
  expect(s.traffic.accounts[key]).toBeUndefined();
  expect(s.traffic.accounts["uid:111"]?.readHour).toBe(1);
});
