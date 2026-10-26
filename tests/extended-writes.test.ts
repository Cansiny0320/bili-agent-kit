import { expect, it } from "vite-plus/test";
import { setup, json, fakeCredentials } from "./helpers.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BiliKit } from "../packages/core/src/kit.js";

it.each(["create", "edit"] as const)(
  "sends text dynamic %s with a content scene and CSRF in the signed query",
  async (mode) => {
    const { kit, calls } = await setup(
      (url) =>
        url.pathname.endsWith("/detail")
          ? json({
              item: {
                id_str: "123",
                type: "DYNAMIC_TYPE_DRAW",
                modules: {
                  module_author: { mid: 111 },
                  module_dynamic: { major: { draw: { items: [] } } },
                },
              },
            })
          : json({ dyn_id_str: "123" }),
      {
        allowedActions: [`dynamic.${mode}`],
        allowedTargets: [mode === "create" ? "account:111" : "dynamic:123"],
      },
    );
    const action =
      mode === "create"
        ? ({ kind: "dynamic.create", uid: "111", text: "approved text" } as const)
        : ({ kind: "dynamic.edit", dynamicId: "123", text: "approved text" } as const);
    const draft = await kit.writes.prepare(action, `dynamic-${mode}`);
    await kit.admin.approve(draft.id, draft.digest, "owner");
    await kit.writes.execute(draft.id);
    await kit.writes.execute(draft.id);
    const writes = calls.filter((call) => call.init.method === "POST");
    expect(writes).toHaveLength(mode === "edit" ? 2 : 1);
    if (mode === "edit") {
      expect(writes[0]!.url.pathname).toBe("/x/dynamic/feed/create/submit_check");
      expect(writes[0]!.url.searchParams.get("csrf")).toBe(fakeCredentials.bili_jct);
      expect(JSON.parse(writes[0]!.init.body as string)).toMatchObject({
        dyn_id_str: "123",
        scene: 2,
        content: { contents: [{ raw_text: "approved text", type: 1, biz_id: "" }] },
      });
    }
    const request = writes.at(-1)!;
    expect(request.url.pathname).toBe(`/x/dynamic/feed/${mode}/dyn`);
    expect(request.url.searchParams.get("csrf")).toBe(fakeCredentials.bili_jct);
    expect(request.url.searchParams.get("platform")).toBe("web");
    expect(request.url.searchParams.get("w_rid")).toMatch(/^[a-f0-9]{32}$/);
    const body = JSON.parse(request.init.body as string);
    expect(body.dyn_req.scene).toBe(2);
    expect(body.dyn_req).not.toHaveProperty("pics");
    expect(body.dyn_req.content.contents).toEqual([
      { raw_text: "approved text", type: 1, biz_id: "" },
    ]);
    expect(body.dyn_id_str).toBe(mode === "edit" ? "123" : undefined);
    expect(body).not.toHaveProperty("csrf");
  },
);

it("preserves existing images when editing only a dynamic's text", async () => {
  const { kit, calls } = await setup(
    (url) =>
      url.pathname.endsWith("/detail")
        ? json({
            item: {
              id_str: "123",
              type: "DYNAMIC_TYPE_DRAW",
              modules: {
                module_author: { mid: 111 },
                module_dynamic: {
                  major: {
                    opus: {
                      pics: [{ url: "https://i0.hdslb.com/image.jpg", width: 640, height: 480 }],
                    },
                  },
                },
              },
            },
          })
        : json({}),
    { allowedActions: ["dynamic.edit"], allowedTargets: ["dynamic:123"] },
  );
  const draft = await kit.writes.prepare(
    { kind: "dynamic.edit", dynamicId: "123", text: "replacement" },
    "preserve-images",
  );
  await kit.admin.approve(draft.id, draft.digest, "owner");
  await kit.writes.execute(draft.id);
  const writes = calls.filter((call) => call.init.method === "POST");
  expect(writes).toHaveLength(2);
  expect(JSON.parse(writes.at(-1)!.init.body as string).dyn_req.pics).toEqual([
    { img_src: "https://i0.hdslb.com/image.jpg", img_width: 640, img_height: 480 },
  ]);
});

it("does not edit a dynamic when the upstream content check rejects it", async () => {
  const { kit, calls } = await setup(
    (url) =>
      url.pathname.endsWith("/detail")
        ? json({
            item: {
              id_str: "123",
              type: "DYNAMIC_TYPE_WORD",
              modules: { module_author: { mid: 111 }, module_dynamic: {} },
            },
          })
        : json({}, -400),
    { allowedActions: ["dynamic.edit"], allowedTargets: ["dynamic:123"] },
  );
  const draft = await kit.writes.prepare(
    { kind: "dynamic.edit", dynamicId: "123", text: "rejected text" },
    "check-rejection",
  );
  await kit.admin.approve(draft.id, draft.digest, "owner");
  await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "UPSTREAM" });
  const writes = calls.filter((call) => call.init.method === "POST");
  expect(writes.map((call) => call.url.pathname)).toEqual(["/x/dynamic/feed/create/submit_check"]);
  expect((await kit.writes.inspect(draft.id)).status).toBe("rejected");
});

it("new writes require both an explicit action and the correct target", async () => {
  const { kit, calls } = await setup(undefined, { allowedTargets: ["video:42"] });
  await expect(
    kit.writes.prepare({ kind: "video.coin", aid: "42", count: 2 }, "coin"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(calls).toHaveLength(0);
});
it("approved coins execute once even if the caller repeats the request", async () => {
  const { kit, calls } = await setup(() => json({ multiply: 2 }), {
    allowedTargets: ["video:42"],
    allowedActions: ["video.coin"],
  });
  const draft = await kit.writes.prepare({ kind: "video.coin", aid: "42", count: 2 }, "coin");
  await kit.admin.approve(draft.id, draft.digest, "owner");
  await kit.writes.execute(draft.id);
  await kit.writes.execute(draft.id);
  const writes = calls.filter((c) => c.init.method === "POST");
  expect(writes).toHaveLength(1);
  expect(writes[0]?.url.pathname).toBe("/x/web-interface/coin/add");
  expect(new URLSearchParams(writes[0]?.init.body as string).get("multiply")).toBe("2");
});
it("uncertain dynamic publishing stays blocked on repeat execution", async () => {
  const { kit, calls } = await setup(
    () => {
      throw Error("network");
    },
    { allowedTargets: ["account:111"], allowedActions: ["dynamic.create"] },
  );
  const draft = await kit.writes.prepare(
    { kind: "dynamic.create", uid: "111", text: "hello" },
    "dynamic",
  );
  await kit.admin.approve(draft.id, draft.digest, "owner");
  await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "UNKNOWN_OUTCOME" });
  const count = calls.length;
  await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "UNKNOWN_OUTCOME" });
  expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
  expect(calls).toHaveLength(count);
});

it("resumes an explicitly reapproved dynamic without repeating completed image uploads", async () => {
  let rejected = true;
  const ctx = await setup(
    (url) =>
      url.pathname.endsWith("/upload_bfs")
        ? json({ image_url: "https://i0.hdslb.com/image.png", image_width: 1, image_height: 1 })
        : json({ dyn_id_str: "123" }, rejected ? -400 : 0),
    { allowedTargets: ["account:111"], allowedActions: ["dynamic.create"] },
  );
  const root = await mkdtemp(join(tmpdir(), "bili-write-image-")),
    file = join(root, "image.png");
  await writeFile(file, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]));
  const kit = new BiliKit({
    ...ctx.options,
    media: { mediaRoot: root, outputRoot: root, ffmpegPath: "unused" },
  });
  const draft = await kit.writes.prepare(
    { kind: "dynamic.create", uid: "111", text: "fixture", images: [{ file }] },
    "with-image",
  );
  await kit.admin.approve(draft.id, draft.digest, "owner");
  await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "UPSTREAM" });
  const failed = await kit.writes.inspect(draft.id);
  expect(failed.steps["image:0"]?.status).toBe("done");
  expect(failed.status).toBe("rejected");
  rejected = false;
  await kit.admin.approve(draft.id, draft.digest, "owner");
  expect(
    (
      await new BiliKit({
        ...ctx.options,
        media: { mediaRoot: root, outputRoot: root, ffmpegPath: "unused" },
      }).writes.execute(draft.id)
    ).status,
  ).toBe("sent");
  expect(ctx.calls.filter((c) => c.url.pathname.endsWith("/upload_bfs"))).toHaveLength(1);
  expect(ctx.calls.filter((c) => c.url.pathname.endsWith("/create/dyn"))).toHaveLength(2);
});
