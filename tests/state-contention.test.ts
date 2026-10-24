import { expect, it, vi } from "vite-plus/test";
import { mkdtemp, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../packages/core/src/state.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
it("retries a transient delete-pending EPERM without stealing or resetting state", async () => {
  const store = new FileStore(await mkdtemp(join(tmpdir(), "bili-lock-")));
  await store.transaction((state) => {
    state.sequence = 7;
  });
  vi.mocked(open).mockRejectedValueOnce(
    Object.assign(new Error("fixture sharing violation"), { code: "EPERM" }),
  );
  await store.transaction((state) => {
    state.sequence += 1;
  });
  expect((await store.snapshot()).sequence).toBe(8);
});
