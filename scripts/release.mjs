import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const registry = "https://registry.npmjs.org/";
const packages = ["core", "cli", "mcp"];

export function validateVersions(tag, manifests) {
  assert.match(tag, /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "Expected a stable vX.Y.Z tag");
  const version = tag.slice(1);
  for (const manifest of manifests)
    assert.equal(manifest.version, version, `${manifest.name} version does not match ${tag}`);
  return version;
}

export function publicationState(published, expectedIntegrity) {
  if (published === null) return "missing";
  assert.equal(
    published.dist?.integrity,
    expectedIntegrity,
    "Published version differs from this artifact; do not overwrite or silently skip it",
  );
  return "published";
}

export async function registryVersion(name, version, fetcher = fetch) {
  const response = await fetcher(`${registry}${encodeURIComponent(name)}/${version}`, {
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404) return null;
  assert.equal(response.status, 200, `Registry lookup failed for ${name}: HTTP ${response.status}`);
  const manifest = await response.json();
  assert.equal(manifest.name, name, "Registry returned a different package");
  assert.equal(manifest.version, version, "Registry returned a different version");
  return manifest;
}

export function releaseNotes(changelog, version) {
  const marker = `## ${version}\n`;
  assert.ok(changelog.includes(marker), `Missing changelog for ${version}`);
  return changelog.split(marker)[1].split(/\n## /)[0].trim() + "\n";
}

export async function waitForPublication(
  read,
  {
    timeoutMs = 600000,
    now = Date.now,
    sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  } = {},
) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const published = await read();
    if (published) return published;
    const remaining = deadline - now();
    assert.ok(
      remaining > 0,
      "npm is still processing this version; check its status before rerunning",
    );
    await sleep(Math.min(10000, remaining));
  }
}

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: "inherit", timeout: 180000 });
}

async function main() {
  const [mode, tag] = process.argv.slice(2);
  assert.ok(["check", "publish"].includes(mode), "Use check or publish with a version tag");
  const manifests = await Promise.all(
    [".", ...packages.map((name) => `packages/${name}`)].map(async (dir) =>
      JSON.parse(await readFile(join(root, dir, "package.json"), "utf8")),
    ),
  );
  const version = validateVersions(tag, manifests);
  assert.equal(manifests[0].private, true, "The workspace root must remain private");
  for (const [i, name] of packages.entries())
    assert.equal(manifests[i + 1].name, `@bili-agent-kit/${name}`);
  const notes = releaseNotes(await readFile(join(root, "CHANGELOG.md"), "utf8"), version);
  if (mode === "check") {
    console.log(`${tag}: workspace versions and release notes match`);
    return;
  }
  assert.equal(process.env.GITHUB_ACTIONS, "true", "Publishing is restricted to GitHub Actions");
  assert.equal(process.env.GITHUB_REF, `refs/tags/${tag}`, "Publishing requires the matching tag");
  assert.equal(process.env.GITHUB_REPOSITORY, "Cansiny0320/bili-agent-kit");
  assert.ok(process.env.ACTIONS_ID_TOKEN_REQUEST_URL, "GitHub OIDC permission is required");
  const artifacts = join(root, "artifacts");
  await mkdir(artifacts, { recursive: true });
  await writeFile(join(artifacts, "release-notes.md"), notes);
  const candidates = [];
  for (const name of packages) {
    run("pnpm", ["pack", "--pack-destination", artifacts], join(root, "packages", name));
    const file = join(artifacts, `bili-agent-kit-${name}-${version}.tgz`);
    const integrity = `sha512-${createHash("sha512")
      .update(await readFile(file))
      .digest("base64")}`;
    candidates.push({ name: `@bili-agent-kit/${name}`, file, integrity });
  }
  // Check every existing version before publishing any missing package.
  for (const candidate of candidates)
    publicationState(await registryVersion(candidate.name, version), candidate.integrity);
  for (const candidate of candidates) {
    if (
      publicationState(await registryVersion(candidate.name, version), candidate.integrity) ===
      "missing"
    ) {
      run("npm", [
        "publish",
        candidate.file,
        "--ignore-scripts",
        "--access",
        "public",
        `--registry=${registry}`,
      ]);
    } else console.log(`${candidate.name}@${version} already matches; skipping`);
    const published = await waitForPublication(() => registryVersion(candidate.name, version));
    publicationState(published, candidate.integrity);
    if (candidate.name !== "@bili-agent-kit/core")
      assert.equal(published.dependencies?.["@bili-agent-kit/core"], version);
    console.log(`Verified ${candidate.name}@${version}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
