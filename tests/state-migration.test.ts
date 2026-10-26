import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vite-plus/test";
import { FileStore, MemoryStore } from "../packages/core/src/state.js";

it("backs up v1 state while preserving traffic and cursors and rejects future versions", async () => {
  const root = await mkdtemp(join(tmpdir(), "bili-migrate-"));
  const current = await new MemoryStore().snapshot();
  const { events: _events, ...old } = current;
  old.version = 1 as 2;
  old.cursors["uid:111:222"] = { revision: 2, lastSeen: 10, lastKeys: ["one"], pending: [] };
  old.traffic.manual["uid:111"] = true;
  const json = JSON.stringify(old);
  await writeFile(join(root, "state.json"), json);
  const store = new FileStore(root);
  await store.transaction((s) => {
    s.sequence++;
  });
  const state = await store.snapshot();
  expect(state.version).toBe(2);
  expect(state.cursors).toEqual(old.cursors);
  expect(state.traffic.manual).toEqual(old.traffic.manual);
  expect(await readFile(join(root, "state.v1.backup.json"), "utf8")).toBe(json);
  await writeFile(join(root, "state.json"), JSON.stringify({ ...state, version: 3 }));
  await expect(store.snapshot()).rejects.toMatchObject({ code: "STATE_INVALID" });
});
