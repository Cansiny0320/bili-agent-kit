import { expect, it } from "vite-plus/test";
import { json, setup } from "./helpers.js";

it("requires every folder and video target in a batch", async () => {
  const { kit, calls } = await setup(undefined, {
    allowedActions: ["favorite.move", "watch_later.batch_add"],
    allowedTargets: ["favorite:10", "video:1"],
  });
  await expect(
    kit.writes.prepare(
      { kind: "favorite.move", sourceFolderId: "10", folderId: "20", aids: ["1"] },
      "move",
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    kit.writes.prepare({ kind: "watch_later.batch_add", aids: ["1", "2"] }, "batch"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(calls).toHaveLength(0);
});

it("rejects duplicate batch members", async () => {
  const { kit } = await setup();
  expect(() => kit.writes.preview({ kind: "watch_later.batch_add", aids: ["1", "1"] })).toThrow();
});

it("keeps an accepted batch unknown when readback is rejected", async () => {
  const { kit, calls } = await setup(
    (_url, init) => (init.method === "POST" ? json({}) : json({}, -400)),
    { allowedActions: ["watch_later.batch_add"], allowedTargets: ["video:1"] },
  );
  const draft = await kit.writes.prepare(
    { kind: "watch_later.batch_add", aids: ["1"] },
    "readback-rejected",
  );
  await kit.admin.approve(draft.id, draft.digest, "owner");
  await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "UNKNOWN_OUTCOME" });
  await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "UNKNOWN_OUTCOME" });
  expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
});

it("binds unchanged folder fields and blocks an edit after another editor changes them", async () => {
  let title = "original";
  const { kit, calls } = await setup(
    () => json({ id: 10, upper: { mid: 111 }, title, intro: "keep", cover: "", attr: 1 }),
    { allowedActions: ["favorite.folder_edit"], allowedTargets: ["favorite:10"] },
  );
  const draft = await kit.writes.prepare(
    { kind: "favorite.folder_edit", folderId: "10", title: "new", intro: undefined },
    "edit",
  );
  expect(draft.action).toMatchObject({ title: "new", intro: "keep", privacy: 1 });
  await kit.admin.approve(draft.id, draft.digest, "owner");
  title = "changed elsewhere";
  await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(0);
});

it("verifies both sides of a move and does not resend a partial result", async () => {
  let posted = false;
  const { kit, calls } = await setup(
    (url, init) => {
      if (url.pathname.endsWith("/folder/info"))
        return json({ id: Number(url.searchParams.get("media_id")), upper: { mid: 111 } });
      if (init.method === "POST") {
        posted = true;
        return json({});
      }
      const source = url.searchParams.get("media_id") === "10";
      return json({
        medias: source
          ? posted
            ? [{ id: 2, type: 2 }]
            : [
                { id: 1, type: 2 },
                { id: 2, type: 2 },
              ]
          : [{ id: 1, type: 2 }],
        has_more: false,
      });
    },
    { allowedActions: ["favorite.move"], allowedTargets: ["favorite:10", "favorite:20"] },
  );
  const draft = await kit.writes.prepare(
    { kind: "favorite.move", sourceFolderId: "10", folderId: "20", aids: ["1", "2"] },
    "partial",
  );
  await kit.admin.approve(draft.id, draft.digest, "owner");
  await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "UNKNOWN_OUTCOME" });
  expect((await kit.writes.inspect(draft.id)).steps.verify?.result).toMatchObject({
    items: [
      { aid: "1", destination: true, source: false },
      { aid: "2", destination: false, source: true },
    ],
  });
  await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "UNKNOWN_OUTCOME" });
  expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
});

it("requires ownership of both folders before moving", async () => {
  const { kit, calls } = await setup(
    (url) =>
      json({
        id: Number(url.searchParams.get("media_id")),
        upper: { mid: url.searchParams.get("media_id") === "10" ? 222 : 111 },
      }),
    { allowedActions: ["favorite.move"], allowedTargets: ["favorite:10", "favorite:20"] },
  );
  const draft = await kit.writes.prepare(
    { kind: "favorite.move", sourceFolderId: "10", folderId: "20", aids: ["1"] },
    "other-owner",
  );
  await kit.admin.approve(draft.id, draft.digest, "owner");
  await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(0);
});

it("passes library pagination and search cursors unchanged", async () => {
  const { kit, calls } = await setup(() => json({}));
  await kit.reads.watch_later_page({
    startKey: "next",
    ascending: true,
    sortField: 0,
    splitKey: "split",
  });
  expect(Object.fromEntries(calls.at(-1)!.url.searchParams)).toMatchObject({
    start_key: "next",
    asc: "true",
    sort_field: "0",
    split_key: "split",
  });
  await kit.reads.favorite_search({
    keyword: "hello",
    startOid: "123",
    startType: 2,
    searchCount: 20,
  });
  expect(calls.at(-1)!.url.pathname).toBe("/x/v3/fav/tab/fav/search");
  expect(calls.at(-1)!.url.searchParams.get("start_oid")).toBe("123");
});

it("uses V3 resource types for batch watch later and confirms every member", async () => {
  const { kit, calls } = await setup(
    (url, init) =>
      init.method === "POST" ? json({}) : json({ list: [{ aid: 1 }, { aid: 2 }], has_more: false }),
    { allowedActions: ["watch_later.batch_add"], allowedTargets: ["video:1", "video:2"] },
  );
  const draft = await kit.writes.prepare(
    { kind: "watch_later.batch_add", aids: ["1", "2"] },
    "batch-verified",
  );
  await kit.admin.approve(draft.id, draft.digest, "owner");
  expect((await kit.writes.execute(draft.id)).result).toMatchObject({
    verified: true,
    items: [
      { aid: "1", destination: true },
      { aid: "2", destination: true },
    ],
  });
  const call = calls.find((c) => c.init.method === "POST")!;
  expect(call.url.pathname).toBe("/x/v3/fav/toview/adds");
  expect(Object.fromEntries(new URLSearchParams(call.init.body as string))).toMatchObject({
    resources: "1:2,2:2",
    toview_version: "v2",
  });
});
