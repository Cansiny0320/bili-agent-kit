import { expect, it } from "vite-plus/test";
import { setup, json, fakeCredentials } from "./helpers.js";
import { BiliKit } from "../packages/core/src/kit.js";
import { FileStore } from "../packages/core/src/state.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { digest, signWbi } from "../packages/core/src/wbi.js";
import { keys } from "./helpers.js";

const dm = { kind: "dm.send", uid: "222", text: "hello" } as const;
it("a persisted sending reservation after a crash cannot dispatch again", async () => {
  const { kit, options, store, calls } = await setup();
  const draft = await kit.writes.prepare(dm, "crash");
  await kit.admin.approve(draft.id, draft.digest, "operator");
  await store.transaction((s) => {
    s.drafts[draft.id]!.status = "sending";
  });
  calls.length = 0;
  await expect(new BiliKit(options).writes.execute(draft.id)).rejects.toMatchObject({
    code: "UNKNOWN_OUTCOME",
  });
  expect(calls).toHaveLength(0);
  await kit.admin.reconcile(draft.id, "not-sent");
  await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
});
it("tampered content cannot reuse a prior approval", async () => {
  const { kit, store, calls } = await setup();
  const draft = await kit.writes.prepare(dm, "tamper");
  await kit.admin.approve(draft.id, draft.digest, "operator");
  await store.transaction((s) => {
    s.drafts[draft.id]!.action = { ...dm, text: "changed" };
  });
  calls.length = 0;
  await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(calls).toHaveLength(0);
});
it("missing mutual follow blocks a DM before sending", async () => {
  const base = await setup();
  const kit = new BiliKit({
    ...base.options,
    fetch: async (input, init) =>
      new URL(input instanceof Request ? input.url : input).pathname === "/x/relation"
        ? json({ attribute: 2 })
        : base.options.fetch(input, init),
  });
  const draft = await kit.writes.prepare(dm, "mutual");
  await kit.admin.approve(draft.id, draft.digest, "operator");
  await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(base.calls.filter((c) => c.init.method === "POST")).toHaveLength(0);
});
it("comment form and WBI query follow the upstream contract without exposing CSRF", async () => {
  const { kit, calls } = await setup();
  const draft = await kit.writes.prepare(
    { kind: "comment.add", oid: "42", text: "hello", root: "11", parent: "12" },
    "comment",
  );
  await kit.admin.approve(draft.id, draft.digest, "operator");
  const sent = await kit.writes.execute(draft.id);
  const call = calls.find((c) => c.init.method === "POST")!;
  const body = new URLSearchParams(call.init.body as string);
  expect(call.url.pathname).toBe("/x/v2/reply/add");
  expect(Object.fromEntries(body)).toMatchObject({
    oid: "42",
    root: "11",
    parent: "12",
    type: "1",
    message: "hello",
    csrf: fakeCredentials.bili_jct,
  });
  const signature = new URLSearchParams(
    signWbi(Object.fromEntries(body), keys, Number(call.url.searchParams.get("wts")) * 1000),
  );
  expect(call.url.searchParams.get("w_rid")).toBe(signature.get("w_rid"));
  expect(JSON.stringify(sent)).not.toContain(fakeCredentials.bili_jct);
});
it("canonical live room and delete-comment targets produce the intended forms", async () => {
  const { kit, calls, clock } = await setup((url) =>
    json(url.pathname.endsWith("/get_info") ? { room_id: 99 } : {}),
  );
  const live = await kit.writes.prepare({ kind: "live.send", roomId: "99", text: "hello" }, "live");
  await kit.admin.approve(live.id, live.digest, "operator");
  await kit.writes.execute(live.id);
  clock.advance(120000);
  const del = await kit.writes.prepare({ kind: "comment.delete", oid: "42", rpid: "12" }, "delete");
  await kit.admin.approve(del.id, del.digest, "operator");
  await kit.writes.execute(del.id);
  const posts = calls.filter((c) => c.init.method === "POST");
  expect(posts.map((c) => c.url.pathname)).toEqual(["/msg/send", "/x/v2/reply/del"]);
  expect(new URLSearchParams(posts[0]?.init.body as string).get("roomid")).toBe("99");
  expect(new URLSearchParams(posts[1]?.init.body as string).get("rpid")).toBe("12");
});
it("read budgets and corrupt state stop before network, including after restart", async () => {
  const { kit, store, options, calls } = await setup();
  const now = options.clock.now();
  await store.transaction((s) => {
    s.traffic.accounts[digest(fakeCredentials.sessdata)] = {
      hourAt: now,
      dayAt: now,
      readHour: 600,
      readDay: 600,
      writeHour: 0,
      writeDay: 0,
      lastWrite: 0,
    };
  });
  await expect(kit.reads.comments({ oid: "42" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  await writeFile(join(store.directory, "state.json"), "{}");
  await expect(
    new BiliKit({ ...options, store: new FileStore(store.directory) }).reads.comments({
      oid: "42",
    }),
  ).rejects.toMatchObject({ code: "STATE_INVALID" });
  expect(calls).toHaveLength(0);
});
it("ambiguous HTTP failures remain unknown while definite rejection cannot silently retry", async () => {
  for (const response of [
    new Response("bad gateway", { status: 502 }),
    Response.json({ unexpected: true }),
  ]) {
    const { kit } = await setup(() => response);
    const draft = await kit.writes.prepare(dm, "failure");
    await kit.admin.approve(draft.id, draft.digest, "operator");
    await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "UNKNOWN_OUTCOME" });
    expect((await kit.writes.inspect(draft.id)).status).toBe("unknown");
  }
  const { kit } = await setup(() => json({}, -400));
  const draft = await kit.writes.prepare(dm, "rejected");
  await kit.admin.approve(draft.id, draft.digest, "operator");
  await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "UPSTREAM" });
  expect((await kit.writes.inspect(draft.id)).status).toBe("rejected");
  await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
});
it("SDK read surface cannot dispatch arbitrary writes", async () => {
  const { kit } = await setup();
  expect(Object.keys(kit.reads)).toEqual(
    expect.arrayContaining([
      "comments",
      "dmHistory",
      "liveHistory",
      "liveInfo",
      "search",
      "subtitles",
      "video",
      "popular",
      "transcript",
    ]),
  );
  expect(
    Object.keys(kit.reads).some((name) => /post|execute|prepare|approve|request/.test(name)),
  ).toBe(false);
  expect(Object.keys(kit.writes)).not.toContain("client");
});
