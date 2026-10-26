import { BiliClient, scrub } from "./client.js";
import { object } from "./traffic.js";
import { KitError } from "./errors.js";

export async function creatorMetrics(client: BiliClient, bvid?: string): Promise<unknown> {
  const session = await client.session(true);
  const data = object(
    scrub(
      await client.get(
        "/x/web/data/archive_diagnose/compare",
        { size: 100 },
        false,
        "https://member.bilibili.com",
        session,
      ),
      session.credentials,
    ),
  );
  if (!Array.isArray(data.list))
    throw new KitError("UPSTREAM", "Creator metrics response is missing its list.");
  const items = data.list.map(object).filter((row) => !bvid || row.bvid === bvid);
  if (bvid && items.length === 0)
    throw new KitError(
      "NOT_FOUND",
      "This video is absent from the latest 100 creator metric rows.",
    );
  if (bvid && items.length !== 1)
    throw new KitError("UPSTREAM", "Creator metrics returned duplicate videos.");
  const rates = [
    "full_play_ratio",
    "active_fans_rate",
    "tm_rate",
    "crash_rate",
    "interact_rate",
    "play_trans_fan_rate",
  ];
  return {
    coverage: "latest_100_manuscripts",
    items: items.map((item) => {
      const stat = object(item.stat),
        percentages: Record<string, number | null> = {};
      for (const name of rates) {
        const raw = stat[name];
        if (raw === undefined) continue;
        if (
          raw !== null &&
          (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 10000)
        )
          throw new KitError("UPSTREAM", "Invalid creator rate metric.");
        percentages[name] = raw === null ? null : raw / 100;
      }
      return { ...item, percentages };
    }),
    fetchedAt: new Date(client.traffic.clock.now()).toISOString(),
  };
}
