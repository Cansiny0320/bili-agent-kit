import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { credentialSchema, parse, type Credentials } from "./contracts.js";
import { KitError } from "./errors.js";

const exec = promisify(execFile);
function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
async function restrictFile(path: string): Promise<void> {
  if (process.platform !== "win32") {
    await chmod(path, 0o600);
    return;
  }
  const system = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
  const { stdout } = await exec(join(system, "whoami.exe"), ["/user", "/fo", "csv", "/nh"], {
    windowsHide: true,
    timeout: 10000,
  });
  const sid = stdout.match(/S-1-\d+(?:-\d+)+/)?.[0];
  if (!sid) throw new KitError("UNAVAILABLE", "Cannot determine current Windows identity.");
  await exec(join(system, "icacls.exe"), [path, "/inheritance:r", "/grant:r", `*${sid}:(F)`], {
    windowsHide: true,
    timeout: 10000,
  });
}
/** Creates a new private file; never overwrites an existing path. */
export async function writePrivateFile(path: string, data: string | Uint8Array): Promise<void> {
  const file = await open(path, "wx", 0o600);
  let complete = false;
  try {
    await restrictFile(path);
    await file.writeFile(data);
    await file.sync();
    complete = true;
  } finally {
    await file.close();
    if (!complete) await unlink(path).catch(() => {});
  }
}
/** Explicit local plaintext file. Atomic replacement; an abandoned lock is never stolen. */
export class FileCredentials {
  readonly path: string;
  constructor(path: string) {
    this.path = resolve(path);
  }
  async read(): Promise<Credentials | undefined> {
    try {
      const info = await lstat(this.path);
      if (!info.isFile() || info.size > 16384) throw new Error("Invalid credential file");
      return parse(credentialSchema, JSON.parse(await readFile(this.path, "utf8")) as unknown);
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw new KitError(
        "AUTH_REQUIRED",
        "Cannot read valid credentials from the configured file.",
      );
    }
  }
  async update(
    fn: (previous: Credentials | undefined) => Promise<Credentials | undefined>,
  ): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    let lock;
    try {
      lock = await open(`${this.path}.lock`, "wx", 0o600);
    } catch {
      throw new KitError(
        "STATE_BUSY",
        "Credential file is locked or inaccessible; check the owning process.",
      );
    }
    const temp = `${this.path}.${randomUUID()}.tmp`;
    try {
      const previous = await this.read();
      const next = await fn(previous);
      if (next === undefined) {
        await unlink(this.path).catch((error) => {
          if (!isMissing(error)) throw error;
        });
        return;
      }
      await writePrivateFile(temp, JSON.stringify(parse(credentialSchema, next)) + "\n");
      await rename(temp, this.path);
      if (process.platform !== "win32") {
        const directory = await open(dirname(this.path), "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } finally {
      await unlink(temp).catch(() => {});
      await lock.close();
      await unlink(`${this.path}.lock`);
    }
  }
}
