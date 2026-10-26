import { spawn } from "node:child_process";
import { mkdir, realpath, readdir, writeFile, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { parse } from "./contracts.js";
import { KitError } from "./errors.js";
import { localFile } from "./files.js";

export interface FrameOptions {
  mediaRoot: string;
  outputRoot: string;
  ffmpegPath: string;
  maxBytes?: number;
  timeoutMs?: number;
}
export const frameInput = z.strictObject({
  file: z.string().min(1).max(4096),
  count: z.number().int().min(1).max(12).default(6),
  intervalSeconds: z.number().min(1).max(600).default(10),
});
export async function sampleFrames(
  options: FrameOptions,
  input: z.input<typeof frameInput>,
): Promise<{ files: string[] }> {
  const args = parse(frameInput, input);
  const local = await localFile(
    options.mediaRoot,
    args.file,
    options.maxBytes ?? 128 * 1024 * 1024,
  );
  const formats: Record<string, string> = {
    ".mp4": "mov",
    ".mov": "mov",
    ".mkv": "matroska",
    ".webm": "matroska",
  };
  const format = formats[extname(local.path).toLowerCase()];
  if (!format) throw new KitError("INVALID_INPUT", "Supported local media: MP4, MOV, MKV, WebM.");
  await mkdir(options.outputRoot, { recursive: true, mode: 0o700 });
  const out = join(await realpath(options.outputRoot), randomUUID());
  await mkdir(out, { mode: 0o700 });
  const file = join(out, `source${extname(local.path)}`);
  await writeFile(file, local.bytes, { flag: "wx", mode: 0o600 });
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        options.ffmpegPath,
        [
          "-nostdin",
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-f",
          format,
          "-i",
          file,
          "-vf",
          `fps=1/${args.intervalSeconds},scale=1280:720:force_original_aspect_ratio=decrease`,
          "-frames:v",
          String(args.count),
          "-threads",
          "2",
          join(out, "frame-%03d.jpg"),
        ],
        {
          shell: false,
          windowsHide: true,
          stdio: "ignore",
          timeout: options.timeoutMs ?? 120000,
          killSignal: "SIGKILL",
        },
      );
      child.once("error", () => reject(new KitError("UNAVAILABLE", "ffmpeg could not run.")));
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new KitError("UNAVAILABLE", "ffmpeg failed or timed out.")),
      );
    });
  } finally {
    await rm(file);
  }
  const files = (await readdir(out))
    .filter((name) => /^frame-\d{3}\.jpg$/.test(name))
    .sort()
    .map((name) => join(out, name));
  if (!files.length) throw new KitError("UNAVAILABLE", "No frames were produced.");
  return { files };
}
