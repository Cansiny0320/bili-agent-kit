import { spawn } from "node:child_process";
import { mkdir, realpath, readdir, writeFile, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { parse } from "./contracts.js";
import { KitError } from "./errors.js";
import { localFile } from "./files.js";
import { timeRange, timeRangeFields } from "./timeline.js";

export interface FrameOptions {
  mediaRoot: string;
  outputRoot: string;
  ffmpegPath: string;
  maxBytes?: number;
  timeoutMs?: number;
}
export const frameTimingFields = {
  ...timeRangeFields,
  timestampsSeconds: z.array(z.number().finite().min(0).max(86400)).min(1).max(12).optional(),
  count: z.number().int().min(1).max(12).default(6),
  intervalSeconds: z.number().min(1).max(600).default(10),
};
export const frameInput = z.strictObject({
  file: z.string().min(1).max(4096),
  ...frameTimingFields,
});
export function frameRequests(input: z.input<typeof frameInput>): number[] | undefined {
  const args = parse(frameInput, input);
  const { start, end } = timeRange(args);
  if (args.timestampsSeconds) {
    if (args.startSeconds !== undefined || args.endSeconds !== undefined)
      throw new KitError("INVALID_INPUT", "Use timestampsSeconds or a time range, not both.");
    return args.timestampsSeconds;
  }
  if (args.startSeconds === undefined && args.endSeconds === undefined) return undefined;
  return Array.from({ length: args.count }, (_, i) => start + i * args.intervalSeconds).filter(
    (t) => t < end,
  );
}
export async function sampleFrames(
  options: FrameOptions,
  input: z.input<typeof frameInput>,
): Promise<{ files: string[]; timestampsSeconds?: number[] }> {
  const args = parse(frameInput, input);
  const timestamps = frameRequests(args);
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
  const deadline = Date.now() + (options.timeoutMs ?? 120000);
  try {
    for (const [index, timestamp] of (timestamps ?? [undefined]).entries()) {
      if (Date.now() >= deadline) throw new KitError("UNAVAILABLE", "Frame sampling timed out.");
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
            ...(timestamp !== undefined ? ["-ss", String(timestamp)] : []),
            "-vf",
            `${timestamp === undefined ? `fps=1/${args.intervalSeconds},` : ""}scale=1280:720:force_original_aspect_ratio=decrease`,
            "-frames:v",
            String(timestamp === undefined ? args.count : 1),
            "-threads",
            "2",
            join(
              out,
              timestamp === undefined
                ? "frame-%03d.jpg"
                : `frame-${String(index + 1).padStart(3, "0")}.jpg`,
            ),
          ],
          {
            shell: false,
            windowsHide: true,
            stdio: "ignore",
            timeout: Math.max(1, deadline - Date.now()),
            killSignal: "SIGKILL",
          },
        );
        child.once("error", () => reject(new KitError("UNAVAILABLE", "ffmpeg could not run.")));
        child.once("exit", (code) =>
          code === 0
            ? resolve()
            : reject(new KitError("UNAVAILABLE", "ffmpeg failed or timed out.")),
        );
      });
    }
  } catch (error) {
    await rm(out, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(file, { force: true });
  }
  const files = (await readdir(out))
    .filter((name) => /^frame-\d{3}\.jpg$/.test(name))
    .sort()
    .map((name) => join(out, name));
  if (!files.length || (timestamps && files.length !== timestamps.length)) {
    await rm(out, { recursive: true, force: true });
    throw new KitError(
      "UNAVAILABLE",
      "A requested timestamp is outside the video or produced no frame.",
    );
  }
  return { files, ...(timestamps ? { timestampsSeconds: timestamps } : {}) };
}
