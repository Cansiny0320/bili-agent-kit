import { it, expect } from "vite-plus/test";
import {
  validateVersions,
  publicationState,
  registryVersion,
  releaseNotes,
  waitForPublication,
} from "../scripts/release.mjs";

it("waits through npm processing longer than one minute without resubmitting", async () => {
  let now = 0;
  let reads = 0;
  const expected = { version: "0.2.0" };
  const published = await waitForPublication(async () => (++reads >= 14 ? expected : null), {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  expect(published).toBe(expected);
  expect(now).toBeGreaterThan(60000);
});

it("stops waiting at its deadline and preserves registry errors", async () => {
  let now = 0;
  await expect(
    waitForPublication(async () => null, {
      timeoutMs: 15000,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    }),
  ).rejects.toThrow("still processing");
  expect(now).toBe(15000);
  await expect(
    waitForPublication(async () => {
      throw new Error("HTTP 503");
    }),
  ).rejects.toThrow("HTTP 503");
});

it("rejects mismatched package versions and non-release tags", () => {
  const manifests = [
    { name: "root", version: "0.2.0" },
    { name: "core", version: "0.2.0" },
  ];
  expect(validateVersions("v0.2.0", manifests)).toBe("0.2.0");
  expect(() => validateVersions("v0.2.1", manifests)).toThrow("version does not match");
  expect(() => validateVersions("main", manifests)).toThrow("stable vX.Y.Z");
});

it("only skips an already published version when its artifact is identical", () => {
  expect(publicationState(null, "sha512-abc")).toBe("missing");
  expect(publicationState({ dist: { integrity: "sha512-abc" } }, "sha512-abc")).toBe("published");
  expect(() => publicationState({ dist: { integrity: "sha512-different" } }, "sha512-abc")).toThrow(
    "differs",
  );
});

it("does not treat registry outages or incorrect metadata as an unpublished version", async () => {
  const fetcher = (status, data) => async () => new Response(JSON.stringify(data), { status });
  expect(await registryVersion("pkg", "1.0.0", fetcher(404, {}))).toBeNull();
  await expect(registryVersion("pkg", "1.0.0", fetcher(503, {}))).rejects.toThrow("HTTP 503");
  await expect(
    registryVersion("pkg", "1.0.0", fetcher(200, { name: "other", version: "1.0.0" })),
  ).rejects.toThrow("different package");
});

it("selects only the matching version's release notes", () => {
  expect(releaseNotes("# Changelog\n\n## 0.2.0\n\nNew\n\n## 0.1.0\nOld\n", "0.2.0")).toBe("New\n");
  expect(() => releaseNotes("# Empty", "0.2.0")).toThrow("Missing changelog");
});
