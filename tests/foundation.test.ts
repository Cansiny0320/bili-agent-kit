import { describe, expect, it } from "vite-plus/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signWbi } from "../packages/core/src/wbi.js";
import { FileStore } from "../packages/core/src/state.js";

describe("upstream WBI protocol", () => {
  it("matches the original v0.4.6 implementation and strips forbidden value characters", () => {
    const keys = {
      img_url: "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
      sub_url: "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
    };
    expect(signWbi({ foo: "114", bar: "514", baz: "1919810" }, keys, 1702204169000)).toBe(
      "bar=514&baz=1919810&foo=114&wts=1702204169&w_rid=6149fdadf571698ca7e6a567265cd0ee",
    );
    expect(signWbi({ foo: "a!'()*b", w_rid: "stale" }, keys, 0)).toMatch(/^foo=ab&wts=0&w_rid=/);
    expect(() => signWbi({}, { img_url: "", sub_url: "" }, 0)).toThrow();
  });
});

describe("durable state", () => {
  it("serializes concurrent independent store instances", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bili-kit-"));
    const stores = Array.from({ length: 8 }, () => new FileStore(dir));
    await Promise.all(
      stores.map((s) =>
        s.transaction((state) => {
          state.sequence += 1;
        }),
      ),
    );
    expect((await new FileStore(dir).snapshot()).sequence).toBe(8);
  });
  it("fails closed on corruption without replacing evidence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bili-kit-"));
    await writeFile(join(dir, "state.json"), "{broken");
    await expect(new FileStore(dir).snapshot()).rejects.toMatchObject({ code: "STATE_INVALID" });
    expect(await readFile(join(dir, "state.json"), "utf8")).toBe("{broken");
  });
});
