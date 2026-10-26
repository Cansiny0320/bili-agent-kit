import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vite-plus/test";
import { BiliKit } from "../packages/core/src/kit.js";
import { setup, json } from "./helpers.js";

const executable = process.env.BILI_TEST_FFMPEG;
it.skipIf(!executable)(
  "decodes real DASH media, samples frames, creates a contact sheet and clips audio",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "bili-decode-")),
      video = join(root, "source.mp4"),
      audio = join(root, "source.m4a");
    const run = promisify(execFile);
    await run(executable!, [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=320x180:r=10",
      "-t",
      "4",
      "-c:v",
      "mpeg4",
      "-threads",
      "1",
      video,
    ]);
    await run(executable!, [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100",
      "-t",
      "4",
      "-c:a",
      "aac",
      "-threads",
      "1",
      audio,
    ]);
    const ctx = await setup(async (url) => {
      if (url.pathname.includes("/view"))
        return json({
          aid: 42,
          bvid: "BV1xx411c7mD",
          title: "fixture",
          pages: [{ cid: 10, page: 1, part: "one", duration: 4 }],
        });
      if (url.pathname.includes("/playurl"))
        return json({
          dash: {
            video: [{ id: 80, baseUrl: "https://upos.bilivideo.com/video" }],
            audio: [{ baseUrl: "https://upos.bilivideo.com/audio" }],
          },
        });
      return new Response(
        new Uint8Array(await readFile(url.pathname === "/video" ? video : audio)),
      );
    });
    const kit = new BiliKit({
      ...ctx.options,
      media: { mediaRoot: root, outputRoot: root, ffmpegPath: executable! },
    });
    const frames = (await kit.media.call("online_frames", {
      reference: "BV1xx411c7mD",
      count: 3,
      intervalSeconds: 1,
      contactSheet: true,
    })) as { file: string; files: string[]; images: { data: string }[] };
    expect(frames.files).toHaveLength(1);
    expect(Buffer.from(frames.images[0]!.data, "base64").subarray(0, 2)).toEqual(
      Buffer.from([255, 216]),
    );
    const clip = (await kit.media.call("audio_clip", {
      file: frames.file,
      startSeconds: 1,
      durationSeconds: 1,
    })) as { file: string };
    expect((await stat(clip.file)).size).toBeGreaterThan(100);
    await run(executable!, ["-nostdin", "-v", "error", "-i", clip.file, "-f", "null", "-"]);
  },
  30000,
);
