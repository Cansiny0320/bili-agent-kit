import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../packages/core/src/state.js";
import { BiliKit } from "../packages/core/src/kit.js";
import type { Clock, Policy } from "../packages/core/src/contracts.js";
export const keys = {
  img_url: "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
  sub_url: "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
};
export const fakeCredentials = { sessdata: "fixture-session-only", bili_jct: "fixture-csrf-only" };
export function fakeClock(): Clock & { advance(ms: number): void } {
  let now = 1702204169000;
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    advance: (ms) => {
      now += ms;
    },
  };
}
export const json = (data: unknown, code = 0) => Response.json({ code, data });
export async function setup(
  handler?: (url: URL, init: RequestInit) => Promise<Response> | Response,
  policy?: Partial<Policy>,
) {
  const store = new FileStore(await mkdtemp(join(tmpdir(), "bili-kit-")));
  const clock = fakeClock();
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    if (url.pathname === "/x/web-interface/nav")
      return json({ mid: 111, isLogin: true, wbi_img: keys });
    if (url.pathname === "/x/relation") return json({ attribute: 6 });
    return handler ? handler(url, init) : json({ rpid: "123" });
  };
  const options = {
    store,
    clock,
    fetch: fetcher,
    credentials: async () => fakeCredentials,
    policy: {
      writesEnabled: true,
      allowedTargets: ["comment:42", "dm:222", "live:99"],
      trustedDmTargets: ["222"],
      ...policy,
    },
  };
  const kit = new BiliKit(options);
  return { kit, store, clock, calls, options };
}
