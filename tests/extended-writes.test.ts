import { expect, it } from "vite-plus/test";
import { setup, json } from "./helpers.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BiliKit } from "../packages/core/src/kit.js";

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
