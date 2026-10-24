import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { stateSchema, type State } from "./contracts.js";
import { KitError } from "./errors.js";

export interface StateStore {
  readonly durable: boolean;
  transaction<T>(fn: (state: State) => T): Promise<T>;
  snapshot(): Promise<State>;
}
function emptyState(): State {
  return {
    version: 1,
    sequence: 0,
    drafts: {},
    cursors: {},
    deviceId: randomUUID(),
    traffic: { lastDispatch: -1e12, until: 0, streak: 0, manual: {}, accounts: {} },
  };
}
function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
function validate(value: unknown): State {
  const parsed = stateSchema.safeParse(value);
  if (!parsed.success)
    throw new KitError(
      "STATE_INVALID",
      "State is corrupt or incompatible; preserve it for administrator review.",
    );
  return parsed.data;
}
/** Local disk only. A leftover lock is never stolen; verify the owner before manual removal. */
export class FileStore implements StateStore {
  readonly durable = true;
  readonly directory: string;
  constructor(directory: string) {
    this.directory = resolve(directory);
  }
  async #read(): Promise<State> {
    try {
      return validate(JSON.parse(await readFile(join(this.directory, "state.json"), "utf8")));
    } catch (error) {
      if (isCode(error, "ENOENT")) return emptyState();
      throw new KitError(
        "STATE_INVALID",
        "Cannot read valid state; no network operation is allowed.",
      );
    }
  }
  async snapshot(): Promise<State> {
    return this.#read();
  }
  async transaction<T>(fn: (state: State) => T): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lockPath = join(this.directory, "state.json.lock");
    const deadline = Date.now() + 3000;
    let lock;
    while (!lock) {
      try {
        lock = await open(lockPath, "wx", 0o600);
      } catch (error) {
        if (!isCode(error, "EEXIST")) throw new KitError("STATE_INVALID", "Cannot lock state.");
        if (Date.now() >= deadline)
          throw new KitError(
            "STATE_BUSY",
            "State is locked; check the owning process before recovery.",
          );
        await delay(20);
      }
    }
    const temp = join(this.directory, `state.json.${randomUUID()}.tmp`);
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      const state = await this.#read();
      const result = fn(state);
      if (result instanceof Promise)
        throw new KitError("STATE_INVALID", "State transactions must be synchronous.");
      const data = JSON.stringify(validate(state));
      const file = await open(temp, "wx", 0o600);
      try {
        await file.writeFile(data);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, join(this.directory, "state.json"));
      if (process.platform !== "win32") {
        const directory = await open(this.directory, "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
      return structuredClone(result);
    } finally {
      await unlink(temp).catch(() => {});
      await lock.close();
      await unlink(lockPath);
    }
  }
}
/** Useful for read-only integrations and tests. External writes require a durable store. */
export class MemoryStore implements StateStore {
  readonly durable = false;
  #state = emptyState();
  async snapshot(): Promise<State> {
    return structuredClone(this.#state);
  }
  async transaction<T>(fn: (state: State) => T): Promise<T> {
    const copy = structuredClone(this.#state);
    const result = fn(copy);
    if (result instanceof Promise)
      throw new KitError("STATE_INVALID", "State transactions must be synchronous.");
    this.#state = validate(copy);
    return structuredClone(result);
  }
}
