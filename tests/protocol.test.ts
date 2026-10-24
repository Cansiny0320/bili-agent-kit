import { expect, it } from "vite-plus/test";
import { setup, json, keys, fakeClock, fakeCredentials } from "./helpers.js";
import { BiliKit } from "../packages/core/src/kit.js";
import { MemoryStore } from "../packages/core/src/state.js";
import { invoke } from "../packages/core/src/operations.js";

it("anonymous video requests use WBI keys from nav code -101", async () => {
  const urls: URL[] = [];
  const kit = new BiliKit({
    store: new MemoryStore(),
    clock: fakeClock(),
    fetch: async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      urls.push(url);
      return url.pathname.endsWith("/nav")
        ? json({ wbi_img: keys }, -101)
        : json({ bvid: "BV1xx411c7mD", aid: 42, title: "A video" });
    },
  });
  await expect(kit.reads.video({ bvid: "BV1xx411c7mD" })).resolves.toMatchObject({ aid: 42 });
  expect(urls[1]?.pathname).toBe("/x/web-interface/wbi/view");
  expect(urls[1]?.searchParams.get("w_rid")).toMatch(/^[a-f0-9]{32}$/);
});
it("subtitles use signed authenticated metadata, then cookie-free CDN and no redirects", async () => {
  const { kit, calls } = await setup((url) =>
    url.pathname === "/x/player/wbi/v2"
      ? json({
          subtitle: {
            subtitles: [
              {
                lan: "ai-zh",
                subtitle_url: "https://aisubtitle.hdslb.com/test.json?auth_key=temporary",
              },
            ],
          },
        })
      : Response.json({ body: [{ from: 0, to: 1, content: "hi" }] }),
  );
  expect(await kit.reads.subtitles({ bvid: "BV1xx411c7mD", cid: "1" })).toMatchObject({
    selected: "ai-zh",
  });
  expect(new Headers(calls[1]?.init.headers).get("cookie")).toContain("fixture-session-only");
  expect(new Headers(calls[2]?.init.headers).has("cookie")).toBe(false);
  expect(calls[2]?.url.searchParams.get("auth_key")).toBe("temporary");
  expect(calls[2]?.init.redirect).toBe("error");
});
it("untrusted subtitle hosts and DM targets are rejected before their network request", async () => {
  const { kit, calls } = await setup(() =>
    json({ subtitle: { subtitles: [{ lan: "zh", subtitle_url: "https://evil.example/leak" }] } }),
  );
  await expect(kit.reads.subtitles({ bvid: "BV1xx411c7mD", cid: "1" })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(kit.reads.dmHistory({ uid: "333" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(calls).toHaveLength(2);
});
it("persistent 429 backoff blocks independent clients, including signed-key refresh", async () => {
  const { kit, options, calls } = await setup(
    () => new Response("{}", { status: 429, headers: { "retry-after": "900" } }),
  );
  await expect(kit.reads.comments({ oid: "42" })).rejects.toMatchObject({ code: "TRAFFIC_PAUSED" });
  await expect(new BiliKit(options).reads.video({ bvid: "BV1xx411c7mD" })).rejects.toMatchObject({
    code: "TRAFFIC_PAUSED",
  });
  expect(calls).toHaveLength(1);
});
it("authenticated login failure persists until administrator intervention", async () => {
  const { kit, options, calls } = await setup(() => json({}, -101));
  await expect(kit.reads.comments({ oid: "42" })).rejects.toMatchObject({ code: "TRAFFIC_PAUSED" });
  await expect(new BiliKit(options).reads.comments({ oid: "42" })).rejects.toMatchObject({
    code: "TRAFFIC_PAUSED",
  });
  expect(calls).toHaveLength(1);
  await kit.admin.resumeAccount();
  await expect(kit.reads.comments({ oid: "42" })).rejects.toMatchObject({ code: "TRAFFIC_PAUSED" });
  expect(calls).toHaveLength(2);
});
it("strict public schemas reject model-supplied approval fields and inherited property names", async () => {
  const { kit, calls } = await setup();
  const result = await invoke(kit, "write_execute", { draftId: "a".repeat(64), approved: true });
  expect(result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  expect(await invoke(kit, "constructor", {})).toMatchObject({ ok: false });
  expect(calls).toHaveLength(0);
});
it("redacts credential echoes and does not return upstream error details", async () => {
  const { kit } = await setup(() =>
    json({
      title: fakeCredentials.sessdata,
      csrf: fakeCredentials.bili_jct,
      nested: { text: fakeCredentials.bili_jct },
    }),
  );
  const output = JSON.stringify(await invoke(kit, "comments", { oid: "42" }));
  expect(output).not.toContain(fakeCredentials.sessdata);
  expect(output).not.toContain(fakeCredentials.bili_jct);
  const failed = await setup(() => {
    throw new Error(fakeCredentials.sessdata);
  });
  expect(JSON.stringify(await invoke(failed.kit, "comments", { oid: "42" }))).not.toContain(
    fakeCredentials.sessdata,
  );
});
