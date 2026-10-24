// Adapted directly from dsh-bili-whale v0.4.6 tools/lib/bili-api.mjs (MIT).
import { createHash } from "node:crypto";
import { KitError } from "./errors.js";
const MIXIN = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54,
  21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];
export interface WbiImages {
  img_url: string;
  sub_url: string;
}
export function signWbi(
  params: Record<string, string | number>,
  images: WbiImages,
  now: number,
): string {
  const keyOf = (url: string) => url.split("/").at(-1)?.split(".")[0] ?? "";
  const raw = keyOf(images.img_url) + keyOf(images.sub_url);
  if (!/^[0-9a-f]{64}$/i.test(raw)) throw new KitError("UPSTREAM", "WBI keys unavailable.");
  const key = MIXIN.map((i) => raw[i])
    .join("")
    .slice(0, 32);
  const values: Record<string, string | number> = { ...params, wts: Math.floor(now / 1000) };
  delete values.w_rid;
  const query = Object.keys(values)
    .sort()
    .map(
      (k) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(String(values[k]).replace(/[!'()*]/g, ""))}`,
    )
    .join("&");
  return `${query}&w_rid=${createHash("md5")
    .update(query + key)
    .digest("hex")}`;
}
export const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
