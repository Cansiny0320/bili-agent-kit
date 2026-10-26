import { expect, it } from "vite-plus/test";
import { setup, json } from "./helpers.js";
import { invoke } from "../packages/core/src/operations.js";

it("signs a user's dynamic feed while preserving its full cursor and web parameters", async () => {
  const { kit, calls, clock } = await setup(() => json({ items: [], has_more: false }));
  const result = await invoke(kit, "user_dynamics", {
    uid: "222",
    offset: "12345678901234567890",
  });
  expect(result).toMatchObject({ ok: true, data: { items: [] } });
  const url = calls.at(-1)!.url;
  expect(url.pathname).toBe("/x/polymer/web-dynamic/v1/feed/space");
  expect(url.searchParams.get("host_mid")).toBe("222");
  expect(url.searchParams.get("offset")).toBe("12345678901234567890");
  expect(url.searchParams.get("platform")).toBe("web");
  expect(url.searchParams.get("timezone_offset")).toBe(
    String(new Date(clock.now()).getTimezoneOffset()),
  );
  expect(url.searchParams.get("w_rid")).toMatch(/^[a-f0-9]{32}$/);
});

it("discovers videos and preserves dynamic cursors without rounding long IDs", async () => {
  const { kit, calls } = await setup((url) =>
    url.pathname.includes("feed/all")
      ? json({
          items: [{ id_str: "12345678901234567890" }],
          offset: "12345678901234567890",
          has_more: true,
        })
      : json({ list: [{ bvid: "BV1xx411c7mD" }], no_more: false }),
  );
  expect(await invoke(kit, "popular", { page: 2, size: 5 })).toMatchObject({ ok: true });
  expect(calls.at(-1)?.url.searchParams.get("pn")).toBe("2");
  const feed = await invoke(kit, "dynamic_feed", { offset: "12345678901234567890" });
  expect(feed).toMatchObject({ ok: true, data: { offset: "12345678901234567890" } });
  expect(calls.at(-1)?.url.searchParams.get("offset")).toBe("12345678901234567890");
});

it("reads a reply thread with its resource identity and does not turn upstream errors into empty lists", async () => {
  const { kit, calls } = await setup((url) =>
    url.pathname.endsWith("/reply/reply")
      ? json({ root: { rpid: "900" }, replies: [{ rpid: "901" }], page: { count: 30 } })
      : json({}, -400),
  );
  expect(await invoke(kit, "comment_replies", { oid: "42", root: "900", page: 2 })).toMatchObject({
    ok: true,
    data: { replies: [{ rpid: "901" }] },
  });
  expect(calls.at(-1)?.url.searchParams.get("root")).toBe("900");
  expect(await invoke(kit, "user", { uid: "222" })).toMatchObject({
    ok: false,
    error: { code: "UPSTREAM" },
  });
});

it("resolves URL part numbers and rejects mismatched subtitle identity", async () => {
  const { kit } = await setup((url) =>
    url.pathname.includes("/view")
      ? json({
          bvid: "BV1xx411c7mD",
          aid: 42,
          title: "parts",
          pages: [
            { cid: 10, page: 1, part: "one" },
            { cid: 20, page: 2, part: "two" },
          ],
        })
      : json({ bvid: "BV1xx411c7mD", aid: 42, cid: 10, subtitle: { subtitles: [] } }),
  );
  expect(
    await invoke(kit, "resolve", { reference: "https://www.bilibili.com/video/BV1xx411c7mD?p=2" }),
  ).toMatchObject({ ok: true, data: { bvid: "BV1xx411c7mD", cid: "20", page: 2 } });
  expect(await invoke(kit, "transcript", { reference: "BV1xx411c7mD", page: 2 })).toMatchObject({
    ok: false,
    error: { code: "UPSTREAM" },
  });
});

it("refuses arbitrary URLs and contradictory reference/part arguments before fetching", async () => {
  const { kit, calls } = await setup();
  expect(
    await invoke(kit, "resolve", { reference: "https://example.com/BV1xx411c7mD" }),
  ).toMatchObject({ ok: false });
  expect(
    await invoke(kit, "resolve", {
      reference: "https://www.bilibili.com/video/BV1xx411c7mD?p=2",
      page: 3,
    }),
  ).toMatchObject({ ok: false });
  expect(calls).toHaveLength(0);
});
