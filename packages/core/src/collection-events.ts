import { ContentReads } from "./reads.js";
import { object } from "./traffic.js";
import { upstreamId } from "./references.js";
import { upstreamText } from "./models.js";
import { KitError } from "./errors.js";
import type { EventMessage } from "./events.js";

export interface CollectionEventInput {
  source: "user_videos" | "collection" | "series";
  uid: string;
  seasonId?: string | undefined;
  seriesId?: string | undefined;
  maxPages: number;
}
export async function scanCollection(
  reads: ContentReads,
  input: CollectionEventInput,
  observedAt: number,
): Promise<EventMessage[]> {
  const rows: EventMessage[] = [],
    ids = new Set<string>();
  let expected: number | undefined;
  for (let page = 1; page <= input.maxPages; page++) {
    const data = object(
      input.source === "user_videos"
        ? await reads.call("user_videos", { uid: input.uid, page, size: 50, order: "pubdate" })
        : input.source === "collection"
          ? await reads.call("collection_videos", {
              uid: input.uid,
              seasonId: input.seasonId!,
              page,
              size: 100,
            })
          : await reads.call("series_videos", {
              uid: input.uid,
              seriesId: input.seriesId!,
              page,
              size: 100,
            }),
    );
    const pagination = object(data.page),
      total = Number(input.source === "user_videos" ? pagination.count : pagination.total);
    if (
      !Number.isSafeInteger(total) ||
      total < 0 ||
      total > 10000 ||
      (expected !== undefined && expected !== total)
    )
      throw new KitError(
        "UPSTREAM",
        "Collection size changed or exceeds the scan limit; cursor preserved.",
      );
    expected = total;
    const archives = input.source === "user_videos" ? object(data.list).vlist : data.archives;
    if (!Array.isArray(archives))
      throw new KitError("UPSTREAM", "Missing collection page; cursor preserved.");
    for (const raw of archives) {
      const row = object(raw),
        key = upstreamId(row.aid);
      if (ids.has(key))
        throw new KitError(
          "UPSTREAM",
          "Collection pagination repeated a member; cursor preserved.",
        );
      ids.add(key);
      const publishedAt = Number(row.pubdate ?? row.created ?? 0);
      if (!Number.isFinite(publishedAt) || publishedAt < 0)
        throw new KitError("UPSTREAM", "Invalid publication timestamp.");
      rows.push({
        key,
        seq: null,
        ts: observedAt,
        sender: input.uid,
        text: upstreamText(row.title),
        data: { ...row, publishedAt, observedAt },
      });
    }
    if (rows.length === expected) return rows;
    if (!archives.length || rows.length > expected) break;
  }
  throw new KitError(
    "UPSTREAM",
    "Collection scan is incomplete; cursor preserved. Increase maxPages within the configured bound.",
  );
}
