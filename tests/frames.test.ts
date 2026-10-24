import { expect, it, vi } from "vite-plus/test";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sampleFrames } from "../packages/core/src/frames.js";
import { spawn } from "node:child_process";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
it("limits media input to the configured directory before launching a process", async () => {
  const root = await mkdtemp(join(tmpdir(), "bili-frames-"));
  const media = join(root, "media");
  await mkdir(media);
  const outside = join(root, "outside.mp4");
  await writeFile(outside, "fixture");
  const options = { mediaRoot: media, outputRoot: join(root, "out"), ffmpegPath: "fixture-ffmpeg" };
  await expect(sampleFrames(options, { file: outside })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  const playlist = join(media, "input.m3u8");
  await writeFile(playlist, "fixture");
  await expect(sampleFrames(options, { file: playlist })).rejects.toMatchObject({
    code: "INVALID_INPUT",
  });
  await expect(sampleFrames(options, { file: outside, count: 100 })).rejects.toMatchObject({
    code: "INVALID_INPUT",
  });
  expect(spawn).not.toHaveBeenCalled();
});
it("uses argument arrays, restricted protocols, hidden windows and a bounded process", async () => {
  const root = await mkdtemp(join(tmpdir(), "bili-frames-"));
  const file = join(root, "a video;name.mp4");
  await writeFile(file, "fixture");
  vi.mocked(spawn).mockImplementation(((_file: string, args: string[]) => {
    const child = new EventEmitter();
    const pattern = args.at(-1)!;
    void writeFile(pattern.replace("%03d", "001"), "fixture-frame").then(() =>
      child.emit("exit", 0),
    );
    return child;
  }) as typeof spawn);
  const result = await sampleFrames(
    { mediaRoot: root, outputRoot: join(root, "out"), ffmpegPath: "fixture-ffmpeg" },
    { file, count: 1 },
  );
  expect(result.files).toHaveLength(1);
  expect(spawn).toHaveBeenCalledWith(
    "fixture-ffmpeg",
    expect.arrayContaining(["file,pipe", file, "-frames:v", "1"]),
    expect.objectContaining({ shell: false, windowsHide: true, timeout: 120000 }),
  );
});
