import { z } from "zod";
import { id, parse } from "./contracts.js";
import { API, BiliClient, scrub } from "./client.js";

const page = z.number().int().min(1).max(10000).default(1);
const size = z.number().int().min(1).max(100).default(30);
export const collectionInputs = {
  collections: z.strictObject({ uid: id, page, size }),
  collection_videos: z.strictObject({ uid: id, seasonId: id, page, size }),
  series: z.strictObject({ seriesId: id }),
  series_videos: z.strictObject({ uid: id, seriesId: id, page, size }),
} as const;
export type CollectionName = keyof typeof collectionInputs;
export async function readCollection(client: BiliClient, name: CollectionName, input: unknown) {
  const a = parse(collectionInputs[name], input) as Record<string, string | number>;
  const session = await client.session();
  const query: Record<string, string | number> =
    name === "series"
      ? { series_id: a.seriesId! }
      : {
          mid: a.uid!,
          ...(name === "series_videos"
            ? { series_id: a.seriesId!, pn: a.page!, ps: a.size! }
            : {
                page_num: a.page!,
                page_size: a.size!,
                ...(name === "collection_videos" ? { season_id: a.seasonId! } : {}),
              }),
        };
  const paths = {
    collections: "/x/polymer/web-space/seasons_series_list",
    collection_videos: "/x/polymer/web-space/seasons_archives_list",
    series: "/x/series/series",
    series_videos: "/x/series/archives",
  };
  return scrub(await client.get(paths[name], query, false, API, session), session.credentials);
}
