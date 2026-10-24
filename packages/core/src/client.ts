import { z } from "zod";
import {
  bvid,
  credentialSchema,
  id,
  parse,
  type CredentialProvider,
  type Credentials,
  type Policy,
} from "./contracts.js";
import { KitError } from "./errors.js";
import { object, Traffic } from "./traffic.js";
import { digest, signWbi, type WbiImages } from "./wbi.js";
import {
  upstream,
  videoSchema,
  searchSchema,
  commentsSchema,
  dmHistorySchema,
  liveInfoSchema,
  liveHistorySchema,
  subtitleBodySchema,
  type Video,
  type SearchResults,
  type Comments,
  type DmHistory,
  type LiveInfo,
  type LiveHistory,
  type Subtitles,
} from "./models.js";

export interface Session {
  account: string;
  credentials: Credentials | undefined;
}
const API = "https://api.bilibili.com";
const VC = "https://api.vc.bilibili.com";
const LIVE = "https://api.live.bilibili.com";
export { API, VC, LIVE };
/** Removes credential fields and known secret values, including echoed values. */
export function scrub(value: unknown, credentials?: Credentials): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const secret of Object.values(credentials ?? {}))
      if (secret) out = out.split(secret).join("[redacted]");
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => scrub(item, credentials));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/^(cookie|authorization|sessdata|bili_jct|csrf|csrf_token|buvid3)$/i.test(key),
        )
        .map(([key, item]) => [key, scrub(item, credentials)]),
    );
  return value;
}
export class BiliClient {
  constructor(
    readonly traffic: Traffic,
    readonly provider: CredentialProvider,
    readonly policy: Policy,
  ) {}
  async session(required = false): Promise<Session> {
    let raw: unknown;
    try {
      raw = await this.provider();
    } catch {
      throw new KitError("AUTH_REQUIRED", "Credential provider failed.");
    }
    const credentials = raw === undefined ? undefined : parse(credentialSchema, raw);
    if (required && !credentials) throw new KitError("AUTH_REQUIRED", "Credentials are required.");
    return { account: digest(credentials?.sessdata ?? "anonymous"), credentials };
  }
  async get(
    path: string,
    params: Record<string, string | number> = {},
    signed = false,
    origin = API,
    session?: Session,
  ): Promise<unknown> {
    const current = session ?? (await this.session());
    const url = new URL(path, origin);
    if (![API, VC, LIVE].includes(url.origin))
      throw new KitError("FORBIDDEN", "API origin not allowed.");
    if (signed) {
      const nav = object(await this.get("/x/web-interface/nav", {}, false, API, current));
      const images = parse(
        z.object({ img_url: z.string(), sub_url: z.string() }),
        nav.wbi_img,
      ) as WbiImages;
      url.search = signWbi(params, images, this.traffic.clock.now());
    } else
      url.search = new URLSearchParams(
        Object.entries(params).map(([k, v]) => [k, String(v)]),
      ).toString();
    return this.traffic.request(
      url,
      { headers: this.headers(current, origin) },
      current.account,
      !!current.credentials,
    );
  }
  headers(session: Session, origin = API): Record<string, string> {
    const c = session.credentials;
    return {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      referer: origin === LIVE ? "https://live.bilibili.com/" : "https://www.bilibili.com/",
      ...(c
        ? {
            cookie: `SESSDATA=${c.sessdata}; bili_jct=${c.bili_jct}${c.buvid3 ? `; buvid3=${c.buvid3}` : ""}`,
          }
        : {}),
    };
  }
  async post(
    path: string,
    fields: Record<string, string>,
    origin: string,
    session: Session,
  ): Promise<unknown> {
    const url = new URL(path, origin);
    if (![API, VC, LIVE].includes(url.origin))
      throw new KitError("FORBIDDEN", "API origin not allowed.");
    if (path === "/x/v2/reply/add") {
      const nav = object(await this.get("/x/web-interface/nav", {}, false, API, session));
      const images = upstream(z.object({ img_url: z.string(), sub_url: z.string() }), nav.wbi_img);
      const signed = new URLSearchParams(signWbi(fields, images, this.traffic.clock.now()));
      url.search = new URLSearchParams({
        w_rid: signed.get("w_rid") ?? "",
        wts: signed.get("wts") ?? "",
      }).toString();
    }
    const data = await this.traffic.request(
      url,
      {
        method: "POST",
        headers: {
          ...this.headers(session, origin),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(fields).toString(),
      },
      session.account,
      true,
    );
    return scrub(data, session.credentials);
  }
  async video(input: { bvid: string }): Promise<Video> {
    const args = parse(z.strictObject({ bvid }), input);
    const s = await this.session();
    return upstream(
      videoSchema,
      scrub(await this.get("/x/web-interface/wbi/view", args, true, API, s), s.credentials),
    );
  }
  async search(input: { keyword: string; page?: number }): Promise<SearchResults> {
    const args = parse(
      z.strictObject({
        keyword: z.string().trim().min(1).max(200),
        page: z.number().int().min(1).max(50).default(1),
      }),
      input,
    );
    const s = await this.session();
    return upstream(
      searchSchema,
      scrub(
        await this.get(
          "/x/web-interface/wbi/search/type",
          { search_type: "video", ...args },
          true,
          API,
          s,
        ),
        s.credentials,
      ),
    );
  }
  async comments(input: { oid: string; page?: number; sort?: number }): Promise<Comments> {
    const args = parse(
      z.strictObject({
        oid: id,
        page: z.number().int().min(1).max(1000).default(1),
        sort: z.union([z.literal(0), z.literal(2)]).default(0),
      }),
      input,
    );
    const s = await this.session();
    return upstream(
      commentsSchema,
      scrub(
        await this.get(
          "/x/v2/reply",
          { oid: args.oid, type: 1, pn: args.page, ps: 20, sort: args.sort },
          false,
          API,
          s,
        ),
        s.credentials,
      ),
    );
  }
  async subtitles(input: {
    bvid: string;
    cid: string;
    language?: string | undefined;
  }): Promise<Subtitles> {
    const args = parse(
      z.strictObject({ bvid, cid: id, language: z.string().min(1).max(30).optional() }),
      input,
    );
    const s = await this.session(true);
    const player = object(
      await this.get("/x/player/wbi/v2", { bvid: args.bvid, cid: args.cid }, true, API, s),
    );
    const sub = player.subtitle == null ? {} : object(player.subtitle);
    const tracks = parse(
      z.array(
        z.object({ lan: z.string(), lan_doc: z.string().optional(), subtitle_url: z.string() }),
      ),
      sub.subtitles ?? [],
    );
    const picked = args.language
      ? tracks.find((t) => t.lan === args.language)
      : (tracks.find((t) => t.lan === "zh-CN") ??
        tracks.find((t) => t.lan === "ai-zh") ??
        tracks[0]);
    if (!picked)
      return {
        tracks: tracks.map(({ lan, lan_doc }) => ({ lan, lan_doc })),
        selected: null,
        body: [],
      };
    const url = new URL(
      picked.subtitle_url.startsWith("//") ? `https:${picked.subtitle_url}` : picked.subtitle_url,
    );
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      !["hdslb.com", "bilibili.com"].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    )
      throw new KitError("FORBIDDEN", "Subtitle CDN URL is not allowed.");
    const data = object(
      await this.traffic.request(
        url,
        {
          headers: {
            "user-agent": this.headers(s)["user-agent"] ?? "",
            referer: "https://www.bilibili.com/",
          },
        },
        s.account,
        false,
        true,
      ),
    );
    return {
      tracks: tracks.map(({ lan, lan_doc }) => ({ lan, lan_doc })),
      selected: picked.lan,
      body: upstream(subtitleBodySchema, scrub(data.body ?? [], s.credentials)),
    };
  }
  requireTrustedDm(uid: string): void {
    parse(id, uid);
    if (!this.policy.trustedDmTargets.includes(uid))
      throw new KitError("FORBIDDEN", "DM target is not trusted.");
  }
  async dmHistory(
    input: { uid: string; beforeSeq?: string | undefined },
    session?: Session,
  ): Promise<DmHistory> {
    const args = parse(
      z.strictObject({
        uid: id,
        beforeSeq: z
          .string()
          .regex(/^\d{1,20}$/)
          .default("0"),
      }),
      input,
    );
    this.requireTrustedDm(args.uid);
    const s = session ?? (await this.session(true));
    return upstream(
      dmHistorySchema,
      scrub(
        await this.get(
          "/svr_sync/v1/svr_sync/fetch_session_msgs",
          { talker_id: args.uid, session_type: 1, size: 30, begin_seqno: args.beforeSeq },
          true,
          VC,
          s,
        ),
        s.credentials,
      ),
    );
  }
  async liveInfo(input: { roomId: string }): Promise<LiveInfo> {
    const args = parse(z.strictObject({ roomId: id }), input);
    const s = await this.session();
    return upstream(
      liveInfoSchema,
      scrub(
        await this.get("/room/v1/Room/get_info", { room_id: args.roomId }, false, LIVE, s),
        s.credentials,
      ),
    );
  }
  async liveHistory(input: { roomId: string }): Promise<LiveHistory> {
    const args = parse(z.strictObject({ roomId: id }), input);
    const s = await this.session();
    return upstream(
      liveHistorySchema,
      scrub(
        await this.get(
          "/xlive/web-room/v1/dM/gethistory",
          { roomid: args.roomId, room_type: 0 },
          false,
          LIVE,
          s,
        ),
        s.credentials,
      ),
    );
  }
}
