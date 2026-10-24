import { spawn } from "node:child_process";
import { mkdir, realpath, readdir } from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { parse } from "./contracts.js";
import { KitError } from "./errors.js";

export interface FrameOptions {
  mediaRoot: string;
  outputRoot: string;
  ffmpegPath: string;
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
  const root = await realpath(options.mediaRoot),
    file = await realpath(args.file);
  const rel = relative(root, file);
  if (!rel || rel.startsWith("..") || isAbsolute(rel))
    throw new KitError("FORBIDDEN", "Media file is outside the configured root.");
  const formats: Record<string, string> = {
    ".mp4": "mov",
    ".mov": "mov",
    ".mkv": "matroska",
    ".webm": "matroska",
  };
  const format = formats[extname(file).toLowerCase()];
  if (!format) throw new KitError("INVALID_INPUT", "Supported local media: MP4, MOV, MKV, WebM.");
  await mkdir(options.outputRoot, { recursive: true, mode: 0o700 });
  const out = join(await realpath(options.outputRoot), randomUUID());
  await mkdir(out, { mode: 0o700 });
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
      { shell: false, windowsHide: true, stdio: "ignore", timeout: 120000 },
    );
    child.once("error", () => reject(new KitError("UNAVAILABLE", "ffmpeg could not run.")));
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new KitError("UNAVAILABLE", "ffmpeg failed or timed out.")),
    );
  });
  const files = (await readdir(out))
    .filter((name) => /^frame-\d{3}\.jpg$/.test(name))
    .sort()
    .map((name) => join(out, name));
  if (!files.length) throw new KitError("UNAVAILABLE", "No frames were produced.");
  return { files };
}
