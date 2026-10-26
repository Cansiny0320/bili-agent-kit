import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vite-plus/test";
import { BiliKit } from "../packages/core/src/kit.js";
import { setup, json } from "./helpers.js";

async function downloadFixture(
  playback: unknown,
  respond = () => new Response(new Uint8Array([1, 2, 3])),
) {
  const root = await mkdtemp(join(tmpdir(), "bili-media-"));
  const ctx = await setup((url) => {
    if (url.pathname.includes("/view"))
      return json({
        aid: 42,
        bvid: "BV1xx411c7mD",
        pages: [{ cid: 10, page: 1, part: "one", duration: 10 }],
      });
    if (url.pathname.includes("/playurl")) return json(playback);
    return respond();
  });
  const kit = new BiliKit({
    ...ctx.options,
    media: { mediaRoot: root, outputRoot: root, ffmpegPath: "ffmpeg", maxBytes: 1024 },
  });
  return { ...ctx, kit, root };
}

it.each([
  ["baseUrl", "backupUrl"],
  ["base_url", "backup_url"],
  ["url", "backup_url"],
])("selects the first allowed %s / %s CDN URL before downloading", async (primary, backup) => {
  const allowed = "https://upos-sz.bilivideo.com/first.m4s";
  const stream = {
    [primary]: "https://edge.mcdn.bilivideo.cn:8082/audio.m4s",
    [backup]: [
      "not-a-url",
      "http://upos-sz.bilivideo.com/insecure.m4s",
      "https://example.com/private",
      "https://user:password@upos-sz.bilivideo.com/private.m4s",
      allowed,
      "https://upos-sz.bilivideo.com/second.m4s",
    ],
  };
  const ctx = await downloadFixture(
    primary === "url" ? { durl: [stream] } : { dash: { audio: [stream] } },
  );
  const result = await ctx.kit.media.download({
    reference: "BV1xx411c7mD",
    kind: primary === "url" ? "video" : "audio",
  });
  expect(await readFile(result.file)).toEqual(Buffer.from([1, 2, 3]));
  expect(result.bytes).toBe(3);
  const mediaCalls = ctx.calls.filter((call) => call.url.hostname !== "api.bilibili.com");
  expect(mediaCalls.map((call) => call.url.href)).toEqual([allowed]);
  expect(new Headers(mediaCalls[0]!.init.headers).has("cookie")).toBe(false);
});

it("does not request any media URL when the primary and backups are invalid", async () => {
  const ctx = await downloadFixture({
    dash: {
      audio: [
        {
          baseUrl: "https://edge.mcdn.bilivideo.cn:8082/audio.m4s",
          backupUrl: ["not-a-url", "https://example.com/private"],
          backup_url: ["http://upos-sz.bilivideo.com/insecure.m4s"],
        },
      ],
    },
  });
  await expect(
    ctx.kit.media.download({ reference: "BV1xx411c7mD", kind: "audio" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(ctx.calls.every((call) => call.url.hostname === "api.bilibili.com")).toBe(true);
  expect(await readdir(ctx.root)).toEqual([]);
});

it("prefers a permitted primary URL without requesting backups", async () => {
  const primary = "https://upos-sz.bilivideo.com/primary.m4s";
  const ctx = await downloadFixture({
    dash: {
      audio: [
        {
          baseUrl: primary,
          backupUrl: ["https://upos-sz.bilivideo.com/backup.m4s"],
        },
      ],
    },
  });
  await ctx.kit.media.download({ reference: "BV1xx411c7mD", kind: "audio" });
  expect(
    ctx.calls
      .filter((call) => call.url.hostname !== "api.bilibili.com")
      .map((call) => call.url.href),
  ).toEqual([primary]);
});

it("preserves media backoff and does not retry a backup after a risk response", async () => {
  const primary = "https://upos-sz.bilivideo.com/primary.m4s";
  const ctx = await downloadFixture(
    {
      dash: {
        audio: [
          {
            baseUrl: primary,
            backupUrl: ["https://upos-sz.bilivideo.com/backup.m4s"],
          },
        ],
      },
    },
    () => new Response("blocked", { status: 412 }),
  );
  const fetchBytes = vi.spyOn(ctx.kit.media, "fetchBytes");
  await expect(
    ctx.kit.media.download({ reference: "BV1xx411c7mD", kind: "audio" }),
  ).rejects.toMatchObject({ code: "TRAFFIC_PAUSED" });
  expect(
    ctx.calls
      .filter((call) => call.url.hostname !== "api.bilibili.com")
      .map((call) => call.url.href),
  ).toEqual([primary]);
  expect(fetchBytes).toHaveBeenCalledExactlyOnceWith(primary, 1024);
  expect((await ctx.store.snapshot()).traffic.until).toBeGreaterThan(ctx.clock.now());
  expect(await readdir(ctx.root)).toEqual([]);
});

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
