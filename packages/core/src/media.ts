import { upstreamText } from "./models.js";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { ffmpeg } from "./media-process.js";
export { ffmpeg } from "./media-process.js";
import { z } from "zod";
import { id, parse } from "./contracts.js";
import { LIVE, BiliClient } from "./client.js";
import { KitError } from "./errors.js";
import { object } from "./traffic.js";
import { referenceInput, resolveVideo } from "./references.js";
import { ContentReads } from "./reads.js";
import { sampleFrames, frameTimingFields, frameRequests, type FrameOptions } from "./frames.js";
import { timeRange, timeRangeFields } from "./timeline.js";
import { imageType, localFile } from "./files.js";
import { asrConfig, asrInput, transcribe, type AsrOptions } from "./asr.js";

export interface MediaOptions extends FrameOptions {
  asr?: AsrOptions | undefined;
  maxBytes?: number;
  timeoutMs?: number;
}
export const mediaConfig = z.strictObject({
  asr: asrConfig.optional(),
  mediaRoot: z.string().min(1),
  outputRoot: z.string().min(1),
  ffmpegPath: z.string().min(1),
  maxBytes: z
    .number()
    .int()
    .positive()
    .max(512 * 1024 * 1024)
    .default(128 * 1024 * 1024),
  timeoutMs: z.number().int().min(1000).max(300000).default(120000),
});
export const mediaInputs = {
  asr_transcribe: asrInput,
  media_download: referenceInput.extend({
    kind: z.enum(["video", "audio"]).default("video"),
    quality: z.number().int().min(16).max(127).default(80),
  }),
  audio_clip: z.strictObject({
    file: z.string().min(1),
    startSeconds: z.number().min(0).max(86400).default(0),
    durationSeconds: z.number().positive().max(3600).default(60),
  }),
  online_frames: referenceInput.extend({
    ...frameTimingFields,
    contactSheet: z.boolean().default(false),
  }),
  subtitle_export: referenceInput.extend({
    ...timeRangeFields,
    language: z.string().max(30).optional(),
    format: z.enum(["json", "text", "srt", "vtt"]).default("srt"),
  }),
  article_export: z.strictObject({ cvid: id }),
  live_frame: z.strictObject({ roomId: id }),
  materials: referenceInput.extend({
    ...frameTimingFields,
    comments: z.boolean().default(true),
    subtitles: z.boolean().default(true),
    frames: z.boolean().default(false),
  }),
} as const;
export type MediaName = keyof typeof mediaInputs;
export type MediaArguments<K extends MediaName> = z.input<(typeof mediaInputs)[K]>;
export interface MediaImage {
  type: "image";
  mimeType: "image/png" | "image/jpeg";
  data: string;
}

export function cdnUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.startsWith("//") ? `https:${value}` : value);
  } catch {
    throw new KitError("UPSTREAM", "Invalid media URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !["hdslb.com", "bilivideo.com", "bilivideo.cn", "bilibili.com", "biliimg.com"].some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  )
    throw new KitError("FORBIDDEN", "Media URL is outside the allowed Bilibili CDN.");
  return url;
}
function streamUrl(stream: unknown): string {
  const s = object(stream);
  const candidates = [
    s.baseUrl,
    s.base_url,
    s.url,
    ...(Array.isArray(s.backupUrl) ? s.backupUrl : []),
    ...(Array.isArray(s.backup_url) ? s.backup_url : []),
  ];
  let firstError: unknown;
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    try {
      return cdnUrl(candidate).href;
    } catch (error) {
      firstError ??= error;
    }
  }
  throw firstError ?? new KitError("UPSTREAM", "Missing stream URL.");
}
export async function mediaImages(root: string, files: string[]): Promise<MediaImage[]> {
  const images: MediaImage[] = [];
  for (const file of files.slice(0, 12)) {
    const { bytes } = await localFile(root, file, 2 * 1024 * 1024);
    images.push({ type: "image", mimeType: imageType(bytes), data: bytes.toString("base64") });
  }
  return images;
}
const inputFile = (file: string, format = "mov") => [
  "-protocol_whitelist",
  "file,pipe",
  "-f",
  format,
  "-i",
  file,
];
export class Media {
  constructor(
    readonly client: BiliClient,
    readonly reads: ContentReads,
    readonly options?: MediaOptions,
  ) {}
  config(): MediaOptions {
    if (!this.options)
      throw new KitError("FORBIDDEN", "Media processing must be configured by the host.");
    return parse(mediaConfig, this.options);
  }
  async directory(): Promise<string> {
    const options = this.config();
    await mkdir(options.outputRoot, { recursive: true, mode: 0o700 });
    return mkdtemp(join(await realpath(options.outputRoot), "bili-"));
  }
  async fetchBytes(url: string, maxBytes: number): Promise<Buffer> {
    const checked = cdnUrl(url),
      session = await this.client.session();
    const bytes = await this.client.traffic.request(
      checked,
      { headers: { "user-agent": "Mozilla/5.0", referer: "https://www.bilibili.com/" } },
      session.account,
      false,
      true,
      { format: "bytes", limit: maxBytes },
    );
    if (!Buffer.isBuffer(bytes) || !bytes.length)
      throw new KitError("UPSTREAM", "Missing media bytes.");
    return bytes;
  }
  async download(input: MediaArguments<"media_download">): Promise<{
    file: string;
    bvid: string;
    cid: string;
    aid: string;
    page: number;
    kind: string;
    bytes: number;
  }> {
    const a = parse(mediaInputs.media_download, input),
      options = this.config();
    const video = await resolveVideo(this.client, {
      reference: a.reference,
      ...(a.page ? { page: a.page } : {}),
    });
    const data = object(
      await this.client.get(
        "/x/player/wbi/playurl",
        { bvid: video.bvid, cid: video.cid, qn: a.quality, fnval: 4048, fourk: 1 },
        true,
      ),
    );
    if (data.is_preview === 1)
      throw new KitError("FORBIDDEN", "Only a preview is available for this account.");
    const dash = object(data.dash ?? {}),
      dir = await this.directory();
    const limit = options.maxBytes ?? 128 * 1024 * 1024;
    let bytes = 0;
    const save = async (stream: unknown, name: string) => {
      const body = await this.fetchBytes(streamUrl(stream), limit - bytes);
      bytes += body.length;
      const file = join(dir, name);
      await writeFile(file, body, { flag: "wx", mode: 0o600 });
      return file;
    };
    try {
      let file: string;
      if (Array.isArray(dash.audio) && dash.audio.length) {
        const audio = await save(dash.audio[0], "audio.m4a");
        if (a.kind === "audio") file = audio;
        else {
          const videos = Array.isArray(dash.video)
            ? dash.video
                .map(object)
                .filter((v) => Number(v.id) <= a.quality)
                .sort((a, b) => Number(b.id) - Number(a.id))
            : [];
          if (!videos.length)
            throw new KitError("UNAVAILABLE", "No video stream is available at this quality.");
          const videoFile = await save(videos[0], "video.m4s");
          file = join(dir, "video.mp4");
          await ffmpeg(options, [
            ...inputFile(videoFile),
            ...inputFile(audio),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c",
            "copy",
            file,
          ]);
          await rm(videoFile);
          await rm(audio);
        }
      } else if (Array.isArray(data.durl) && data.durl.length === 1) {
        const source = await save(data.durl[0], "source.mp4");
        if (a.kind === "video") file = source;
        else {
          file = join(dir, "audio.m4a");
          await ffmpeg(options, [...inputFile(source), "-vn", "-c:a", "aac", file]);
          await rm(source);
        }
      } else throw new KitError("UNAVAILABLE", "No supported complete media stream is available.");
      return { file, ...video, kind: a.kind, bytes };
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
  }
  async call<K extends MediaName>(name: K, input: MediaArguments<K>): Promise<unknown> {
    const a = parse(mediaInputs[name], input) as Record<string, unknown>;
    if (name === "asr_transcribe") {
      const options = this.config();
      if (!options.asr)
        throw new KitError("FORBIDDEN", "ASR requires host whisper.cpp and model configuration.");
      if (typeof a.reference === "string") {
        const audio = await this.download({
          reference: String(a.reference),
          kind: "audio",
          ...(a.page ? { page: Number(a.page) } : {}),
        });
        const { reference: _reference, page: _page, ...local } = a;
        return {
          ...(await transcribe({ ...options, mediaRoot: options.outputRoot }, options.asr, {
            ...local,
            file: audio.file,
          })),
          bvid: audio.bvid,
          cid: audio.cid,
        };
      }
      return transcribe(options, options.asr, a);
    }
    const range = {
      ...(a.startSeconds !== undefined ? { startSeconds: Number(a.startSeconds) } : {}),
      ...(a.endSeconds !== undefined ? { endSeconds: Number(a.endSeconds) } : {}),
    };
    if (["online_frames", "materials", "subtitle_export"].includes(name)) timeRange(range);
    const frameArgs = {
      ...range,
      ...(a.timestampsSeconds ? { timestampsSeconds: a.timestampsSeconds as number[] } : {}),
      ...(a.count !== undefined ? { count: Number(a.count) } : {}),
      ...(a.intervalSeconds !== undefined ? { intervalSeconds: Number(a.intervalSeconds) } : {}),
    };
    if (["online_frames", "materials"].includes(name))
      frameRequests({ file: "pending", ...frameArgs });
    if (name === "media_download") return this.download(a as MediaArguments<"media_download">);
    if (name === "materials") {
      const reference = {
        reference: String(a.reference),
        ...(a.page ? { page: Number(a.page) } : {}),
      };
      const video = await resolveVideo(this.client, reference),
        missing: { source: string; code: string }[] = [];
      const material: Record<string, unknown> = {
        video,
        fetchedAt: new Date(this.client.traffic.clock.now()).toISOString(),
        source: `https://www.bilibili.com/video/${video.bvid}?p=${video.page}`,
      };
      material.metadata = await this.client.video({ bvid: video.bvid });
      for (const [key, enabled, run] of [
        ["comments", a.comments, () => this.client.comments({ oid: video.aid })],
        ["subtitles", a.subtitles, () => this.reads.call("transcript", { ...reference, ...range })],
        [
          "frames",
          a.frames,
          () => this.call("online_frames", { ...reference, ...frameArgs, contactSheet: true }),
        ],
      ] as const)
        if (enabled) {
          try {
            material[key] = await run();
          } catch (error) {
            if (
              !(error instanceof KitError) ||
              !["NOT_FOUND", "UNAVAILABLE", "AUTH_REQUIRED"].includes(error.code)
            )
              throw error;
            missing.push({ source: key, code: error.code });
          }
        }
      return { ...material, missing };
    }
    const options = this.config();
    if (name === "online_frames") {
      const video = await this.download({
        reference: String(a.reference),
        ...(a.page ? { page: Number(a.page) } : {}),
      });
      const frames = await sampleFrames(
        { ...options, mediaRoot: options.outputRoot },
        { file: video.file, ...frameArgs },
      );
      let files = frames.files;
      if (a.contactSheet) {
        const file = join(await this.directory(), "contact-sheet.jpg");
        const columns = Math.min(3, files.length),
          rows = Math.ceil(files.length / columns);
        await ffmpeg(options, [
          "-protocol_whitelist",
          "file,pipe",
          "-f",
          "image2",
          "-i",
          join(frames.files[0]!, "..", "frame-%03d.jpg"),
          "-vf",
          `scale=480:-1,tile=${columns}x${rows}`,
          "-frames:v",
          "1",
          file,
        ]);
        files = [file];
      }
      return {
        ...video,
        files,
        intervalSeconds: a.intervalSeconds,
        ...(frames.timestampsSeconds ? { timestampsSeconds: frames.timestampsSeconds } : {}),
        images: await mediaImages(options.outputRoot, files),
      };
    }
    if (name === "audio_clip") {
      const local = await localFile(
        options.mediaRoot,
        String(a.file),
        options.maxBytes ?? 128 * 1024 * 1024,
      );
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
      const format = formats[extname(local.path).toLowerCase()];
      if (!format) throw new KitError("INVALID_INPUT", "Unsupported audio source format.");
      const dir = await this.directory(),
        source = join(dir, `source${extname(local.path)}`),
        file = join(dir, "clip.m4a");
      await writeFile(source, local.bytes, { flag: "wx", mode: 0o600 });
      try {
        await ffmpeg(options, [
          ...inputFile(source, format),
          "-ss",
          String(a.startSeconds),
          "-t",
          String(a.durationSeconds),
          "-vn",
          "-c:a",
          "aac",
          "-fs",
          String(options.maxBytes),
          file,
        ]);
      } finally {
        await rm(source);
      }
      return { file, startSeconds: a.startSeconds, durationSeconds: a.durationSeconds };
    }
    if (name === "live_frame") {
      const room = object(await this.reads.call("live_resolve", { roomId: String(a.roomId) }));
      const info = object(
        await this.client.get(
          "/room/v1/Room/get_info",
          { room_id: String(room.room_id) },
          false,
          LIVE,
        ),
      );
      if (typeof info.keyframe !== "string" || !info.keyframe)
        throw new KitError("NOT_FOUND", "No live keyframe is available.");
      const bytes = await this.fetchBytes(info.keyframe, 2 * 1024 * 1024),
        mimeType = imageType(bytes);
      const file = join(await this.directory(), mimeType === "image/png" ? "live.png" : "live.jpg");
      await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
      return {
        roomId: String(room.room_id),
        fetchedAt: new Date(this.client.traffic.clock.now()).toISOString(),
        title: info.title,
        file,
        images: [{ type: "image", mimeType, data: bytes.toString("base64") }],
      };
    }
    if (name === "subtitle_export") {
      const result = object(
        await this.reads.call("transcript", a as MediaArguments<"subtitle_export">),
      );
      if (!result.selected) throw new KitError("NOT_FOUND", "No matching subtitles are available.");
      const file = join(
        await this.directory(),
        `subtitles.${a.format === "text" ? "txt" : String(a.format)}`,
      );
      await writeFile(
        file,
        a.format === "json" ? JSON.stringify(result.body, null, 2) : String(result.text),
        { flag: "wx", mode: 0o600 },
      );
      return {
        file,
        bvid: result.bvid,
        cid: result.cid,
        language: result.selected,
        format: a.format,
      };
    }
    const article = object(await this.reads.call("article", { cvid: String(a.cvid) }));
    if (typeof article.content !== "string")
      throw new KitError("UPSTREAM", "Article response does not contain its body.");
    const source = `https://www.bilibili.com/read/cv${String(a.cvid)}`;
    const markdown = `# ${upstreamText(article.title)}\n\n来源：${source}\n\n${articleMarkdown(article.content)}\n`;
    const file = join(await this.directory(), `cv${String(a.cvid)}.md`);
    await writeFile(file, markdown, { flag: "wx", mode: 0o600 });
    return { file, source, markdown };
  }
}
export function articleMarkdown(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<h([1-6])[^>]*>/gi, (_, level: string) => `\n${"#".repeat(Number(level))} `)
    .replace(/<img\b[^>]*\b(?:data-src|src)=["']([^"']+)["'][^>]*>/gi, (_, src: string) => {
      try {
        return `\n![](${cdnUrl(src).href})\n`;
      } catch {
        return "";
      }
    })
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|h[1-6]|li|blockquote)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(
      /&(?:amp|lt|gt|quot|apos|nbsp);/g,
      (entity) =>
        ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " })[
          entity
        ] ?? entity,
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
