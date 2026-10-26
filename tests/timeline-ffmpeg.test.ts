import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { sampleFrames } from "../packages/core/src/frames.js";

const executable = process.env.BILI_TEST_FFMPEG;
it.skipIf(!executable)(
  "extracts the requested timestamps and rejects points past the video",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "bili-timeline-"));
    const file = join(root, "two-colors.mp4"),
      run = promisify(execFile);
    await run(executable!, [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=160x90:r=10:d=1",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=160x90:r=10:d=1",
      "-filter_complex",
      "[0:v][1:v]concat=n=2:v=1:a=0[v]",
      "-map",
      "[v]",
      "-c:v",
      "mpeg4",
      file,
    ]);
    const options = { mediaRoot: root, outputRoot: root, ffmpegPath: executable! };
    const frames = await sampleFrames(options, { file, timestampsSeconds: [0.25, 1.25] });
    expect(frames.timestampsSeconds).toEqual([0.25, 1.25]);
    const colors = [];
    for (const frame of frames.files) {
      const { stdout } = await run(
        executable!,
        [
          "-v",
          "error",
          "-i",
          frame,
          "-vf",
          "scale=1:1",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "pipe:1",
        ],
        { encoding: "buffer" },
      );
      colors.push([...stdout.subarray(0, 3)]);
    }
    expect(colors[0]![0]).toBeGreaterThan(200);
    expect(colors[0]![2]).toBeLessThan(50);
    expect(colors[1]![2]).toBeGreaterThan(200);
    expect(colors[1]![0]).toBeLessThan(50);
    const range = await sampleFrames(options, {
      file,
      startSeconds: 0.25,
      endSeconds: 1.75,
      intervalSeconds: 1,
    });
    expect(range.timestampsSeconds).toEqual([0.25, 1.25]);
    await expect(
      sampleFrames(options, { file, timestampsSeconds: [0.25, 3] }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(
      sampleFrames(options, { file, timestampsSeconds: [1], startSeconds: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  },
  30000,
);
