import { afterEach, expect, it, vi } from "vite-plus/test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadAuth, loadKit } from "../packages/core/src/runtime.js";
import { runCli } from "../packages/cli/src/index.js";

const home = vi.hoisted(() => vi.fn<() => string>());
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: home,
}));
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bili-default-config-"));
  roots.push(root);
  home.mockReturnValue(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("initializes one private default config for concurrent CLI/SDK/MCP loaders", async () => {
  const root = await fixture();
  const [kit, auth, second] = await Promise.all([loadKit(), loadAuth(), loadAuth()]);
  expect(kit).toBeDefined();
  expect(auth.credentials.path).toBe(join(root, ".bili-agent-kit", "credentials.json"));
  expect(second.credentials.path).toBe(auth.credentials.path);
  const config = JSON.parse(await readFile(join(root, ".bili-agent-kit", "config.json"), "utf8"));
  expect(config).toMatchObject({
    version: 1,
    stateDir: "./state",
    credentialsFile: "./credentials.json",
  });
  expect(config.policy?.writesEnabled ?? false).toBe(false);
  expect(await readdir(join(root, ".bili-agent-kit"))).toEqual(["config.json"]);
  expect(await runCli(["auth.status"], async () => "")).toMatchObject({
    ok: true,
    data: { authenticated: false },
  });
});

it("preserves configured defaults and rejects corrupt or missing explicit configs", async () => {
  const root = await fixture();
  await loadAuth();
  const file = join(root, ".bili-agent-kit", "config.json");
  const configured = JSON.stringify({
    version: 1,
    stateDir: "./custom",
    credentialsFile: "./custom.json",
  });
  await writeFile(file, configured);
  expect((await loadAuth()).credentials.path).toBe(join(root, ".bili-agent-kit", "custom.json"));
  expect(await readFile(file, "utf8")).toBe(configured);
  await expect(loadAuth(join(root, "missing.json"))).rejects.toMatchObject({
    code: "INVALID_INPUT",
  });
  await writeFile(file, "broken");
  await expect(loadAuth()).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(await readFile(file, "utf8")).toBe("broken");
});

it("CLI accepts optional config and JSON without initializing files for help or invalid syntax", async () => {
  const root = await fixture();
  expect((await runCli(["help"], async () => "")).ok).toBe(true);
  expect((await runCli(["--config"], async () => "")).ok).toBe(false);
  expect((await runCli(["video", "bad-json"], async () => "")).ok).toBe(false);
  expect(await readdir(root)).toEqual([]);
  const auth = await loadAuth();
  const load = vi.fn(async (_path?: string) => auth);
  // Exercise parsing separately; the production loader is covered above.
  expect(
    await runCli(["--config", "chosen.json", "auth.status"], async () => "", undefined, { load }),
  ).toMatchObject({ ok: true });
  expect(load).toHaveBeenCalledWith("chosen.json");
  expect(await runCli(["auth.status", "-"], async () => "{}", undefined, { load })).toMatchObject({
    ok: true,
  });
  expect(load).toHaveBeenLastCalledWith(undefined);
});
