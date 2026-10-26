import { upstream, upstreamText } from "./models.js";
import { z } from "zod";
import { BiliClient, API } from "./client.js";
import { bvid, id, parse } from "./contracts.js";
import { KitError } from "./errors.js";
import { object } from "./traffic.js";

export const referenceInput = z.strictObject({
  reference: z.string().trim().min(1).max(2048),
  page: z.number().int().min(1).max(10000).optional(),
});
export type ReferenceInput = z.input<typeof referenceInput>;
export interface VideoReference {
  bvid: string;
  aid: string;
  cid: string;
  page: number;
  title: string;
  duration: number;
  pages: { cid: string; page: number; part: string; duration: number }[];
}
export function upstreamId(value: unknown): string {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "number" && !Number.isSafeInteger(value)) ||
    !/^[1-9]\d{0,19}$/.test(String(value))
  )
    throw new KitError("UPSTREAM", "Invalid upstream identifier.");
  return String(value);
}
function videoUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new KitError("INVALID_INPUT", "Expected BV, AV or a Bilibili video URL.");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !["www.bilibili.com", "bilibili.com", "m.bilibili.com", "b23.tv"].includes(url.hostname)
  )
    throw new KitError("INVALID_INPUT", "Only Bilibili video URLs and b23.tv links are supported.");
  url.protocol = "https:";
  return url;
}
export async function resolveVideo(
  client: BiliClient,
  input: ReferenceInput,
): Promise<VideoReference> {
  const args = parse(referenceInput, input);
  let reference = args.reference,
    page = args.page ?? 1;
  if (/^https?:\/\//.test(reference)) {
    let url = videoUrl(reference);
    const seen = new Set<string>();
    while (url.hostname === "b23.tv") {
      if (seen.has(url.href) || seen.size >= 3)
        throw new KitError("UPSTREAM", "Short-link redirect loop.");
      seen.add(url.href);
      const session = await client.session();
      const location = await client.traffic.request(
        url,
        { headers: { "user-agent": "Mozilla/5.0" } },
        session.account,
        false,
        true,
        { format: "location" },
      );
      if (typeof location !== "string")
        throw new KitError("UPSTREAM", "Short link did not resolve to a video.");
      url = videoUrl(new URL(location, url).href);
    }
    const match = /^\/video\/(BV[0-9A-Za-z]{10}|av[1-9]\d*)\/?$/.exec(url.pathname);
    if (!match) throw new KitError("INVALID_INPUT", "URL is not a video page.");
    reference = match[1]!;
    const urlPage = url.searchParams.get("p");
    if (urlPage !== null) {
      if (
        !/^[1-9]\d{0,3}$/.test(urlPage) ||
        (args.page !== undefined && args.page !== Number(urlPage))
      )
        throw new KitError("INVALID_INPUT", "Invalid or conflicting video part.");
      page = Number(urlPage);
    }
  }
  const params = reference.startsWith("BV")
    ? { bvid: parse(bvid, reference) }
    : /^av[1-9]\d{0,19}$/i.test(reference)
      ? { aid: parse(id, reference.slice(2)) }
      : { aid: parse(id, reference) };
  const data = object(await client.get("/x/web-interface/wbi/view", params, true, API));
  const videoBvid = parse(bvid, data.bvid),
    aid = upstreamId(data.aid);
  if ((params.bvid && params.bvid !== videoBvid) || (params.aid && params.aid !== aid))
    throw new KitError("UPSTREAM", "Video identity does not match the requested reference.");
  if (!Array.isArray(data.pages)) throw new KitError("UPSTREAM", "Video part metadata is missing.");
  const pages = data.pages.map((row) => {
    const p = object(row);
    return {
      cid: upstreamId(p.cid),
      page: upstream(z.number().int().positive(), p.page),
      part: upstreamText(p.part),
      duration: upstream(z.number().finite().nonnegative(), p.duration ?? 0),
    };
  });
  const selected = pages.find((p) => p.page === page);
  if (!selected) throw new KitError("NOT_FOUND", "Requested video part does not exist.");
  return {
    bvid: videoBvid,
    aid,
    cid: selected.cid,
    page,
    title: upstreamText(data.title),
    duration: selected.duration,
    pages,
  };
}
