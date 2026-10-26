import { spawn } from "node:child_process";
import { mkdtemp, mkdir, realpath, readFile, stat, rm, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { z } from "zod";
import { localFile } from "./files.js";
import { KitError } from "./errors.js";
import type { MediaOptions } from "./media.js";
import { ffmpeg } from "./media-process.js";
import { parse } from "./contracts.js";
import { formatSubtitles } from "./reads.js";

export const asrConfig = z.strictObject({
  executable: z.string().min(1),
  model: z.string().min(1),
  timeoutMs: z.number().int().min(1000).max(1800000).default(300000),
  threads: z.number().int().min(1).max(16).default(4),
});
export type AsrOptions = z.input<typeof asrConfig>;
export const asrInput = z
  .strictObject({
    file: z.string().min(1).optional(),
    reference: z.string().min(1).max(2048).optional(),
    page: z.number().int().min(1).max(10000).optional(),
    startSeconds: z.number().finite().min(0).max(86400).default(0),
    durationSeconds: z.number().finite().positive().max(3600).default(600),
    language: z
      .string()
      .regex(/^(auto|[a-z]{2,3})$/)
      .default("auto"),
    format: z.enum(["json", "text", "srt", "vtt"]).default("json"),
  })
  .refine((a) => Boolean(a.file) !== Boolean(a.reference) && (!a.page || Boolean(a.reference)));
const whisperResult = z.object({
  transcription: z
    .array(
      z.object({
        offsets: z.object({
          from: z.number().finite().nonnegative(),
          to: z.number().finite().nonnegative(),
        }),
        text: z.string(),
      }),
    )
    .max(100000),
});
export function normalizeWhisper(value: unknown, start: number, duration: number) {
  const result = whisperResult.safeParse(value);
  if (!result.success) throw new KitError("UPSTREAM", "Invalid whisper.cpp JSON output.");
  return result.data.transcription.flatMap((row) => {
    if (row.offsets.to < row.offsets.from)
      throw new KitError("UPSTREAM", "Invalid ASR timestamp order.");
    const from = row.offsets.from / 1000,
      to = Math.min(duration, row.offsets.to / 1000);
    return from < to && row.text.trim()
      ? [{ from: start + from, to: start + to, content: row.text.trim() }]
      : [];
  });
}
export async function transcribe(
  options: MediaOptions,
  asr: AsrOptions,
  input: z.input<typeof asrInput>,
) {
  const config = parse(asrConfig, asr),
    a = parse(asrInput, input);
  if (!a.file)
    throw new KitError("INVALID_INPUT", "Resolve the online audio before transcription.");
  const model = await realpath(config.model).catch(() => {
    throw new KitError("UNAVAILABLE", "ASR model file is missing.");
  });
  if (!(await stat(model)).isFile()) throw new KitError("UNAVAILABLE", "ASR model is not a file.");
  const file = await localFile(options.mediaRoot, a.file, options.maxBytes ?? 128 * 1024 * 1024);
  const formats: Record<string, string> = {
    ".mp4": "mov",
    ".m4a": "mov",
    ".m4s": "mov",
    ".mov": "mov",
    ".mkv": "matroska",
    ".webm": "matroska",
    ".mp3": "mp3",
    ".wav": "wav",
    ".flac": "flac",
  };
  const format = formats[extname(file.path).toLowerCase()];
  if (!format) throw new KitError("INVALID_INPUT", "Unsupported ASR audio format.");
  await mkdir(options.outputRoot, { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(join(await realpath(options.outputRoot), "bili-asr-"));
  try {
    const source = join(dir, `source${extname(file.path)}`),
      audio = join(dir, "audio.wav"),
      output = join(dir, "result");
    await writeFile(source, file.bytes, { mode: 0o600, flag: "wx" });
    await ffmpeg(options, [
      "-protocol_whitelist",
      "file,pipe",
      "-f",
      format,
      "-i",
      source,
      "-ss",
      String(a.startSeconds),
      "-t",
      String(a.durationSeconds),
      "-vn",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      audio,
    ]);
    if ((await stat(audio)).size <= 44)
      throw new KitError("UNAVAILABLE", "No audio in the requested interval.");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        config.executable,
        [
          "-m",
          model,
          "-f",
          audio,
          "-l",
          a.language,
          "-t",
          String(config.threads),
          "-oj",
          "-of",
          output,
          "-np",
        ],
        {
          shell: false,
          stdio: "ignore",
          windowsHide: true,
          timeout: config.timeoutMs,
          killSignal: "SIGKILL",
        },
      );
      child.once("error", () => reject(new KitError("UNAVAILABLE", "whisper.cpp could not run.")));
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new KitError("UNAVAILABLE", "ASR failed or timed out.")),
      );
    });
    if ((await stat(`${output}.json`)).size > 8 * 1024 * 1024)
      throw new KitError("UPSTREAM", "ASR output exceeds the size limit.");
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(`${output}.json`, "utf8"));
    } catch {
      throw new KitError("UPSTREAM", "ASR output is not JSON.");
    }
    const body = normalizeWhisper(raw, a.startSeconds, a.durationSeconds);
    const text = a.format === "json" ? undefined : formatSubtitles(body, a.format);
    return {
      engine: "whisper.cpp",
      generated: true,
      source: file.path,
      startSeconds: a.startSeconds,
      durationSeconds: a.durationSeconds,
      language: a.language,
      format: a.format,
      body,
      ...(text === undefined ? {} : { text }),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
