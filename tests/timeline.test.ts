import { expect, it } from "vite-plus/test";
import { clipSubtitles, timeRange } from "../packages/core/src/timeline.js";
import { setup, json } from "./helpers.js";

it("clips intersecting subtitles while retaining the source timeline", () => {
  expect(
    clipSubtitles(
      [
        { from: 0, to: 2, content: "before" },
        { from: 2, to: 5, content: "left" },
        { from: 6, to: 10, content: "right" },
        { from: 8, to: 9, content: "after" },
      ],
      { startSeconds: 3, endSeconds: 8 },
    ),
  ).toEqual([
    { from: 3, to: 5, content: "left" },
    { from: 6, to: 8, content: "right" },
  ]);
  expect(() => timeRange({ startSeconds: 4, endSeconds: 4 })).toThrow();
});

it("exports the selected transcript range on the original time axis", async () => {
  const { kit } = await setup((url) => {
    if (url.pathname === "/x/web-interface/wbi/view")
      return json({
        aid: 42,
        bvid: "BV1xx411c7mD",
        title: "fixture",
        pages: [{ cid: 10, page: 1, part: "one" }],
      });
    if (url.pathname.includes("/player/"))
      return json({
        subtitle: { subtitles: [{ lan: "zh-CN", subtitle_url: "https://i0.hdslb.com/sub.json" }] },
      });
    return Response.json({ body: [{ from: 1, to: 8, content: "text" }] });
  });
  const value = await kit.reads.transcript({
    reference: "BV1xx411c7mD",
    startSeconds: 3,
    endSeconds: 5,
    format: "srt",
  });
  expect(value).toMatchObject({
    body: [{ from: 3, to: 5, content: "text" }],
    text: "1\n00:00:03,000 --> 00:00:05,000\ntext\n",
  });
});
