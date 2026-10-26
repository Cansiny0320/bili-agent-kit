import { createHash, createHmac } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vite-plus/test";
import { BiliKit } from "../packages/core/src/kit.js";
import { signOpen } from "../packages/core/src/open-platform.js";
import { setup, json } from "./helpers.js";
const credentials = {
  clientId: "app-fixture",
  appSecret: "app-secret-fixture",
  accessToken: "access-token-fixture",
  uid: "111",
  scopes: ["ARC_BASE", "ATC_BASE"],
};
it("signs the exact UTF-8 body using sorted 2.0 headers without a trailing newline", () => {
  const headers = signOpen(credentials, '{"title":"测试"}', 1702204169000, "nonce");
  expect(headers["x-bili-content-md5"]).toBe(
    createHash("md5").update('{"title":"测试"}').digest("hex"),
  );
  const text = Object.keys(headers)
    .filter((k) => k.startsWith("x-bili-"))
    .sort()
    .map((k) => `${k}:${headers[k]}`)
    .join("\n");
  expect(headers.authorization).toBe(
    createHmac("sha256", credentials.appSecret).update(text).digest("hex"),
  );
  expect(headers["access-token"]).toBe(credentials.accessToken);
});
it("requires independent open platform credentials and scopes before networking", async () => {
  const ctx = await setup();
  await expect(ctx.kit.open.call("open_video_list", {})).rejects.toMatchObject({
    code: "AUTH_REQUIRED",
  });
  const kit = new BiliKit({
    ...ctx.options,
    openPlatform: { credentials: async () => ({ ...credentials, scopes: [] }) },
  });
  await expect(kit.open.call("open_video_list", {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(ctx.calls).toHaveLength(0);
});
it("resumes a rejected publish without repeating uploads or exposing its token", async () => {
  const root = await mkdtemp(join(tmpdir(), "bili-open-")),
    file = join(root, "video.mp4");
  const bytes = Buffer.alloc(10 * 1024 * 1024 + 7, 3);
  await writeFile(file, bytes);
  let submissions = 0;
  const ctx = await setup(
    (url) => {
      if (url.pathname.endsWith("/video/init"))
        return json({ upload_token: "private-upload-token" });
      if (url.pathname.endsWith("/add-by-utoken")) {
        submissions++;
        return submissions === 1
          ? new Response(JSON.stringify({ code: -400, message: "rejected" }))
          : json({ resource_id: "BV1xx411c7mD" });
      }
      return json({});
    },
    { allowedActions: ["open.video.publish"], allowedTargets: ["open:111"] },
  );
  const kit = new BiliKit({
    ...ctx.options,
    credentials: async () => undefined,
    media: { mediaRoot: root, outputRoot: root, ffmpegPath: "ffmpeg" },
    openPlatform: { credentials: async () => credentials },
  });
  const draft = await kit.writes.prepare(
    {
      kind: "open.video.publish",
      uid: "111",
      video: { file },
      metadata: { title: "test", tid: 21, tag: "test" },
    },
    "publish",
  );
  await kit.admin.approve(draft.id, draft.digest, "owner");
  await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "UPSTREAM" });
  const approval = await kit.admin.approve(draft.id, draft.digest, "owner");
  expect(JSON.stringify(approval)).not.toContain("private-upload-token");
  const result = await kit.writes.execute(draft.id);
  await kit.writes.execute(draft.id);
  const parts = ctx.calls.filter((c) => c.url.pathname.endsWith("/part/upload"));
  expect(parts.map((p) => p.url.searchParams.get("part_number"))).toEqual(["1", "2"]);
  expect(parts.map((p) => (p.init.body as Uint8Array).byteLength)).toEqual([10 * 1024 * 1024, 7]);
  expect(
    parts.every(
      (p) =>
        !new Headers(p.init.headers).has("access-token") &&
        !new Headers(p.init.headers).has("cookie"),
    ),
  ).toBe(true);
  expect(ctx.calls.filter((c) => c.url.pathname.endsWith("/add-by-utoken"))).toHaveLength(2);
  const paths = ctx.calls.map((c) => c.url.pathname);
  expect(paths.indexOf("/arcopen/fn/archive/video/complete")).toBeLessThan(
    paths.indexOf("/arcopen/fn/archive/add-by-utoken"),
  );
  expect(JSON.stringify(result)).not.toContain("private-upload-token");
  expect(JSON.stringify(await kit.writes.inspect(draft.id))).not.toContain("private-upload-token");
});
