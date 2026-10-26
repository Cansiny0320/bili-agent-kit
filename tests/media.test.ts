import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { BiliKit } from "../packages/core/src/kit.js";
import { setup, json } from "./helpers.js";

it("rejects media URLs outside the Bilibili CDN without requesting them", async () => {
  const root = await mkdtemp(join(tmpdir(), "bili-media-"));
  const ctx = await setup((url) =>
    url.pathname.includes("/view")
      ? json({
          aid: 42,
          bvid: "BV1xx411c7mD",
          pages: [{ cid: 10, page: 1, part: "one", duration: 10 }],
        })
      : json({ dash: { audio: [{ baseUrl: "https://example.com/private" }] } }),
  );
  const kit = new BiliKit({
    ...ctx.options,
    media: { mediaRoot: root, outputRoot: root, ffmpegPath: "ffmpeg" },
  });
  await expect(
    kit.media.call("media_download", { reference: "BV1xx411c7mD", kind: "audio" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(ctx.calls.some((c) => c.url.hostname === "example.com")).toBe(false);
});

it("downloads permitted CDN audio without cookies and enforces its size limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "bili-media-"));
  const ctx = await setup((url) => {
    if (url.pathname.includes("/view"))
      return json({
        aid: 42,
        bvid: "BV1xx411c7mD",
        pages: [{ cid: 10, page: 1, part: "one", duration: 10 }],
      });
    if (url.pathname.includes("/playurl"))
      return json({ dash: { audio: [{ baseUrl: "https://upos-sz.bilivideo.com/audio.m4s" }] } });
    return new Response(new Uint8Array([1, 2, 3]));
  });
  const kit = new BiliKit({
    ...ctx.options,
    media: { mediaRoot: root, outputRoot: root, ffmpegPath: "ffmpeg", maxBytes: 1024 },
  });
  const result = (await kit.media.call("media_download", {
    reference: "BV1xx411c7mD",
    kind: "audio",
  })) as { file: string };
  expect(await readFile(result.file)).toEqual(Buffer.from([1, 2, 3]));
  expect(new Headers(ctx.calls.at(-1)?.init.headers).has("cookie")).toBe(false);
  const small = new BiliKit({
    ...ctx.options,
    media: { mediaRoot: root, outputRoot: root, ffmpegPath: "ffmpeg", maxBytes: 2 },
  });
  await expect(
    small.media.call("media_download", { reference: "BV1xx411c7mD", kind: "audio" }),
  ).rejects.toMatchObject({ code: "UPSTREAM" });
});

it("rejects attachment changes after approval before uploading", async () => {
  const root = await mkdtemp(join(tmpdir(), "bili-image-")),
    file = join(root, "test.png");
  await writeFile(file, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]));
  const ctx = await setup(undefined, {
    allowedActions: ["dynamic.create"],
    allowedTargets: ["account:111"],
  });
  const kit = new BiliKit({
    ...ctx.options,
    media: { mediaRoot: root, outputRoot: root, ffmpegPath: "ffmpeg" },
  });
  const draft = await kit.writes.prepare(
    { kind: "dynamic.create", uid: "111", text: "image", images: [{ file }] },
    "image",
  );
  await kit.admin.approve(draft.id, draft.digest, "owner");
  await writeFile(file, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]));
  await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(ctx.calls.some((c) => c.init.method === "POST")).toBe(false);
});
