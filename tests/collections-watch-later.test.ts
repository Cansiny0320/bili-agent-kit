import { expect, it } from "vite-plus/test";
import { setup, json, fakeCredentials } from "./helpers.js";

it("exposes collection directories and distinct series/season pagination", async () => {
  const { kit, calls } = await setup(() => json({ archives: [], page: { total: 0 } }));
  await kit.reads.collections({ uid: "2267573", page: 2, size: 5 });
  await kit.reads.collection_videos({ uid: "2267573", seasonId: "514597", page: 2 });
  await kit.reads.series({ seriesId: "396050" });
  await kit.reads.series_videos({ uid: "2267573", seriesId: "396050", page: 3 });
  const requests = calls.filter((c) => !c.url.pathname.endsWith("/nav"));
  expect(requests.map((c) => c.url.pathname)).toEqual([
    "/x/polymer/web-space/seasons_series_list",
    "/x/polymer/web-space/seasons_archives_list",
    "/x/series/series",
    "/x/series/archives",
  ]);
  expect(requests[0]!.url.searchParams.get("page_num")).toBe("2");
  expect(requests[1]!.url.searchParams.get("season_id")).toBe("514597");
  expect(requests[3]!.url.searchParams.get("pn")).toBe("3");
});

it.each(["add", "remove"] as const)(
  "watch later %s requires approval and sends once",
  async (mode) => {
    const kind = `watch_later.${mode}` as const;
    const { kit, calls } = await setup(
      (_url, init) =>
        init.method === "POST"
          ? json({})
          : json({ list: mode === "add" ? [{ aid: 42 }] : [], has_more: false }),
      {
        allowedActions: [kind],
        allowedTargets: ["video:42"],
      },
    );
    const draft = await kit.writes.prepare({ kind, aid: "42" }, `watch-${mode}`);
    await expect(kit.writes.execute(draft.id)).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    await kit.admin.approve(draft.id, draft.digest, "owner");
    await kit.writes.execute(draft.id);
    await kit.writes.execute(draft.id);
    const writes = calls.filter((c) => c.init.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.url.pathname).toBe(
      `/x/v2/history/toview/${mode === "add" ? "add" : "v2/dels"}`,
    );
    const fields = new URLSearchParams(writes[0]!.init.body as string);
    expect(fields.get(mode === "add" ? "aid" : "resources")).toBe("42");
    expect(fields.get("csrf")).toBe(fakeCredentials.bili_jct);
  },
);

it("watch later remains disabled unless the host enables the action", async () => {
  const { kit, calls } = await setup(undefined, { allowedTargets: ["video:42"] });
  await expect(
    kit.writes.prepare({ kind: "watch_later.add", aid: "42" }, "disabled"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(calls).toHaveLength(0);
});
