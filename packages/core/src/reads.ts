import { creatorMetrics } from "./creator.js";
import { collectionInputs, readCollection, type CollectionName } from "./collections.js";
import { clipSubtitles, timeRange, timeRangeFields } from "./timeline.js";
import { z } from "zod";
import { BiliClient, API, LIVE, scrub } from "./client.js";
import { id, bvid, parse } from "./contracts.js";
import { KitError } from "./errors.js";
import { object } from "./traffic.js";
import { decodeDanmaku } from "./danmaku.js";
import { referenceInput, resolveVideo } from "./references.js";

const page = z.number().int().min(1).max(1000).default(1);
const size = z.number().int().min(1).max(50).default(20);
const cursor = z.string().max(300).default("");
export const readInputs = {
  ...collectionInputs,
  creator_metrics: z.strictObject({ bvid: bvid.optional() }),
  popular: z.strictObject({ page, size }),
  ranking: z.strictObject({ rid: z.number().int().min(0).default(0) }),
  hot_search: z.strictObject({}),
  search_advanced: z.strictObject({
    keyword: z.string().trim().min(1).max(200),
    type: z.enum(["video", "bili_user", "article", "live_room"]).default("video"),
    page,
    order: z
      .enum(["totalrank", "click", "pubdate", "dm", "stow", "scores", "fans", "level"])
      .default("totalrank"),
    duration: z.number().int().min(0).max(4).default(0),
  }),
  user: z.strictObject({ uid: id }),
  user_videos: z.strictObject({
    uid: id,
    page,
    size,
    order: z.enum(["pubdate", "click", "stow"]).default("pubdate"),
  }),
  followings: z.strictObject({ uid: id, page, size }),
  followers: z.strictObject({ uid: id, page, size }),
  favorite_folders: z.strictObject({ uid: id }),
  favorite_items: z.strictObject({
    folderId: id,
    page,
    size,
    keyword: z.string().max(200).default(""),
  }),
  history: z.strictObject({
    max: cursor,
    viewAt: z.number().int().nonnegative().default(0),
    business: z.string().max(30).default(""),
  }),
  watch_later: z.strictObject({}),
  watch_later_page: z.strictObject({
    startKey: cursor,
    splitKey: cursor,
    ascending: z.boolean().default(false),
    sortField: z.number().int().min(0).max(2).default(0),
  }),
  favorite_search: z.strictObject({
    keyword: z.string().trim().min(1).max(200),
    folderId: id.optional(),
    startOid: z
      .string()
      .regex(/^\d{1,20}$/)
      .default("0"),
    startType: z.number().int().min(0).max(30).default(0),
    searchCount: z.number().int().min(0).max(10000).default(0),
    page,
    size,
  }),
  related: z.strictObject({ bvid }),
  tags: z.strictObject({ bvid }),
  dynamic_feed: z.strictObject({ offset: cursor, type: z.enum(["all", "video"]).default("all") }),
  user_dynamics: z.strictObject({ uid: id, offset: cursor }),
  dynamic: z.strictObject({ dynamicId: id }),
  articles: z.strictObject({ uid: id, page, size }),
  article: z.strictObject({ cvid: id }),
  notifications: z.strictObject({
    kind: z.enum(["reply", "at", "like", "unread"]),
    cursorId: id.optional(),
    cursorTime: z.number().int().nonnegative().optional(),
  }),
  comment_replies: z.strictObject({ oid: id, root: id, page, size }),
  comment_pinned: z.strictObject({ oid: id }),
  comment_check: z.strictObject({
    oid: id,
    rpid: id,
    root: id.optional(),
    maxPages: z.number().int().min(1).max(10).default(3),
  }),
  resolve: referenceInput,
  transcript: referenceInput.extend({
    ...timeRangeFields,
    language: z.string().max(30).optional(),
    format: z.enum(["json", "text", "srt", "vtt"]).default("json"),
  }),
  video_danmaku: referenceInput.extend({ segment: z.number().int().min(1).max(10000).default(1) }),
  video_summary: referenceInput,
  live_resolve: z.strictObject({ roomId: id }),
} as const;
export type ReadName = keyof typeof readInputs;
export type ReadArguments<K extends ReadName> = z.input<(typeof readInputs)[K]>;
export type ReadMethods = { [K in ReadName]: (input: ReadArguments<K>) => Promise<unknown> };
export function readMethods(content: ContentReads): ReadMethods {
  return Object.fromEntries(
    Object.keys(readInputs).map((name) => [
      name,
      (input: ReadArguments<ReadName>) => content.call(name as ReadName, input),
    ]),
  ) as ReadMethods;
}
export class ContentReads {
  constructor(readonly client: BiliClient) {}
  async call<K extends ReadName>(name: K, input: ReadArguments<K>): Promise<unknown> {
    if (Object.hasOwn(collectionInputs, name))
      return readCollection(this.client, name as CollectionName, input);
    const a = parse(readInputs[name], input) as Record<string, string | number | undefined>;
    if (name === "resolve") return resolveVideo(this.client, input as ReadArguments<"resolve">);
    const session = await this.client.session(
      [
        "history",
        "watch_later",
        "watch_later_page",
        "favorite_search",
        "dynamic_feed",
        "notifications",
        "transcript",
      ].includes(name),
    );
    const get = async (
      path: string,
      params: Record<string, string | number> = {},
      signed = false,
      origin = API,
    ) => scrub(await this.client.get(path, params, signed, origin, session), session.credentials);
    const uid = String(a.uid),
      pn = Number(a.page),
      ps = Number(a.size);
    switch (name) {
      case "creator_metrics":
        return creatorMetrics(this.client, a.bvid ? String(a.bvid) : undefined);
      case "popular":
        return get("/x/web-interface/popular", { pn, ps });
      case "ranking":
        return get("/x/web-interface/ranking/v2", { rid: Number(a.rid), type: "all" });
      case "hot_search":
        return get("/x/web-interface/search/square", { limit: 10 });
      case "search_advanced":
        return get(
          "/x/web-interface/wbi/search/type",
          {
            search_type: String(a.type),
            keyword: String(a.keyword),
            page: pn,
            order: String(a.order),
            duration: Number(a.duration),
          },
          true,
        );
      case "user":
        return get("/x/space/wbi/acc/info", { mid: uid }, true);
      case "user_videos":
        return get("/x/space/wbi/arc/search", { mid: uid, pn, ps, order: String(a.order) }, true);
      case "followings":
      case "followers":
        return get(`/x/relation/${name}`, { vmid: uid, pn, ps });
      case "favorite_folders":
        return get("/x/v3/fav/folder/created/list-all", { up_mid: uid });
      case "favorite_items":
        return get("/x/v3/fav/resource/list", {
          media_id: String(a.folderId),
          pn,
          ps,
          keyword: String(a.keyword),
          order: "mtime",
          type: 0,
          tid: 0,
          platform: "web",
        });
      case "history":
        return get("/x/web-interface/history/cursor", {
          max: String(a.max),
          view_at: Number(a.viewAt),
          business: String(a.business),
          ps: 30,
        });
      case "watch_later":
        return get("/x/v2/history/toview");
      case "watch_later_page":
        return get("/x/v2/history/toview/v2/list", {
          start_key: String(a.startKey),
          split_key: String(a.splitKey),
          asc: String(a.ascending),
          sort_field: Number(a.sortField),
        });
      case "favorite_search":
        return get("/x/v3/fav/tab/fav/search", {
          keyword: String(a.keyword),
          start_oid: String(a.startOid),
          start_otype: Number(a.startType),
          search_count: Number(a.searchCount),
          pn,
          count: ps,
          ...(a.folderId ? { media_id: String(a.folderId) } : {}),
        });
      case "related":
        return get("/x/web-interface/archive/related", { bvid: String(a.bvid) });
      case "tags":
        return get("/x/tag/archive/tags", { bvid: String(a.bvid) });
      case "dynamic_feed":
        return get("/x/polymer/web-dynamic/v1/feed/all", {
          offset: String(a.offset),
          type: String(a.type),
        });
      case "user_dynamics":
        return get(
          "/x/polymer/web-dynamic/v1/feed/space",
          {
            host_mid: uid,
            offset: String(a.offset),
            platform: "web",
            timezone_offset: new Date(this.client.traffic.clock.now()).getTimezoneOffset(),
          },
          true,
        );
      case "dynamic":
        return get("/x/polymer/web-dynamic/v1/detail", { id: String(a.dynamicId) });
      case "articles":
        return get("/x/space/article", { mid: uid, pn, ps, sort: "publish_time" });
      case "article":
        return get("/x/article/view", { id: String(a.cvid) });
      case "notifications":
        return a.kind === "unread"
          ? get("/x/msgfeed/unread")
          : get(`/x/msgfeed/${String(a.kind)}`, {
              build: 0,
              mobi_app: "web",
              ...(a.cursorId ? { id: String(a.cursorId) } : {}),
              ...(a.cursorTime !== undefined
                ? {
                    [a.kind === "like" ? "like_time" : a.kind === "at" ? "at_time" : "reply_time"]:
                      Number(a.cursorTime),
                  }
                : {}),
            });
      case "comment_replies":
        return get("/x/v2/reply/reply", {
          type: 1,
          oid: String(a.oid),
          root: String(a.root),
          pn,
          ps,
        });
      case "comment_pinned": {
        const data = object(
          await get("/x/v2/reply/main", { type: 1, oid: String(a.oid), mode: 3, next: 0 }),
        );
        return { replies: data.top_replies ?? [], upper: data.upper ?? null };
      }
      case "comment_check": {
        for (let current = 1; current <= Number(a.maxPages); current++) {
          const data = object(
            await get(a.root ? "/x/v2/reply/reply" : "/x/v2/reply", {
              type: 1,
              oid: String(a.oid),
              pn: current,
              ps: 20,
              ...(a.root ? { root: String(a.root) } : {}),
            }),
          );
          if (data.replies !== null && !Array.isArray(data.replies))
            throw new KitError("UPSTREAM", "Missing comment list.");
          const replies = (data.replies ?? []) as unknown[];
          const found = [data.root, ...replies].find((r) => r && String(object(r).rpid) === a.rpid);
          if (found) return { status: "found", comment: found, pagesRead: current };
          if (replies.length < 20) return { status: "not_found", pagesRead: current };
        }
        return { status: "incomplete", pagesRead: Number(a.maxPages) };
      }
      case "transcript": {
        const range = {
          startSeconds: a.startSeconds as number | undefined,
          endSeconds: a.endSeconds as number | undefined,
        };
        timeRange(range);
        const video = await resolveVideo(this.client, {
          reference: String(a.reference),
          ...(a.page !== undefined ? { page: Number(a.page) } : {}),
        });
        const subtitles = await this.client.subtitles({
          bvid: video.bvid,
          cid: video.cid,
          ...(a.language ? { language: String(a.language) } : {}),
        });
        const body = clipSubtitles(subtitles.body, range);
        return {
          ...video,
          ...subtitles,
          body,
          format: a.format,
          ...(a.format !== "json" ? { text: formatSubtitles(body, String(a.format)) } : {}),
        };
      }
      case "video_danmaku": {
        const video = await resolveVideo(this.client, {
          reference: String(a.reference),
          ...(a.page !== undefined ? { page: Number(a.page) } : {}),
        });
        const url = new URL("/x/v2/dm/web/seg.so", API);
        url.search = new URLSearchParams({
          type: "1",
          oid: video.cid,
          segment_index: String(a.segment),
        }).toString();
        const bytes = await this.client.traffic.request(
          url,
          { headers: this.client.headers(session) },
          session.account,
          !!session.credentials,
          true,
          { format: "bytes", limit: 8 * 1024 * 1024 },
        );
        if (!Buffer.isBuffer(bytes)) throw new KitError("UPSTREAM", "Missing danmaku data.");
        return {
          ...video,
          segment: a.segment,
          segmentDurationSeconds: 360,
          items: decodeDanmaku(bytes),
        };
      }
      case "video_summary": {
        const video = await resolveVideo(this.client, a as ReadArguments<"resolve">);
        const metadata = await this.client.video({ bvid: video.bvid });
        const owner = object(metadata.owner);
        return get(
          "/x/web-interface/view/conclusion/get",
          { bvid: video.bvid, cid: video.cid, up_mid: String(owner.mid) },
          true,
        );
      }
      case "live_resolve":
        return get("/room/v1/Room/room_init", { id: String(a.roomId) }, false, LIVE);
    }
  }
}
export function formatSubtitles(
  lines: { from: number; to: number; content: string }[],
  format: string,
): string {
  const time = (n: number) => {
    const ms = Math.round(Math.max(0, n) * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}${format === "srt" ? "," : "."}${String(ms % 1000).padStart(3, "0")}`;
  };
  if (format === "text") return lines.map((l) => l.content).join("\n");
  return (
    (format === "vtt" ? "WEBVTT\n\n" : "") +
    lines.map((l, i) => `${i + 1}\n${time(l.from)} --> ${time(l.to)}\n${l.content}\n`).join("\n")
  );
}
