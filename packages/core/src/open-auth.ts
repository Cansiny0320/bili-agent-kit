import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, lstat, open, rename, unlink } from "node:fs/promises";
import { z } from "zod";
import { openCredentialSchema } from "./open-platform.js";
import { writePrivateFile } from "./credentials.js";
import { parse } from "./contracts.js";
import { KitError } from "./errors.js";
import { Traffic } from "./traffic.js";
import { digest } from "./wbi.js";

const fileSchema = openCredentialSchema.partial({ accessToken: true, scopes: true });
type AuthFile = z.output<typeof fileSchema>;
const tokenSchema = z.object({
  access_token: z.string().min(1).max(4096),
  refresh_token: z.string().min(1).max(4096),
  expires_in: z.number().int().positive(),
  scopes: z.array(z.string()).max(100).optional(),
});
export const openAuthInputs = {
  "open.auth.begin": z.strictObject({ redirectUrl: z.url() }),
  "open.auth.exchange": z.strictObject({
    code: z.string().min(1).max(4096),
    state: z.string().min(1).max(256),
  }),
  "open.auth.refresh": z.strictObject({}),
  "open.auth.status": z.strictObject({}),
  "open.auth.logout": z.strictObject({}),
} as const;

/** Trusted host management. Never register these methods as model-facing tools. */
export class OpenAuth {
  constructor(
    readonly file: string,
    readonly traffic: Traffic,
  ) {}
  private async read(): Promise<AuthFile> {
    try {
      const info = await lstat(this.file);
      if (!info.isFile() || info.size > 16384) throw Error("invalid");
      return parse(fileSchema, JSON.parse(await readFile(this.file, "utf8")));
    } catch {
      throw new KitError(
        "AUTH_REQUIRED",
        "Configure an independent OAuth credential file with clientId, appSecret and the host account uid.",
      );
    }
  }
  private async save(path: string, value: unknown) {
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writePrivateFile(temp, JSON.stringify(value) + "\n");
      await rename(temp, path);
    } finally {
      await unlink(temp).catch(() => {});
    }
  }
  private async locked<T>(run: (file: AuthFile) => Promise<T>): Promise<T> {
    let lock;
    try {
      lock = await open(`${this.file}.lock`, "wx", 0o600);
    } catch {
      throw new KitError("STATE_BUSY", "OAuth credentials are locked or inaccessible.");
    }
    try {
      return await run(await this.read());
    } finally {
      await lock.close();
      await unlink(`${this.file}.lock`);
    }
  }
  private describe(file: AuthFile) {
    return {
      configured: true,
      uid: file.uid,
      authorized:
        !!file.accessToken &&
        !file.refreshPending &&
        (file.expiresAt === undefined || file.expiresAt > this.traffic.clock.now()),
      expiresAt: file.expiresAt ?? null,
      scopes: file.scopes ?? [],
      refreshPending: file.refreshPending ?? false,
    };
  }
  async status() {
    return this.describe(await this.read());
  }
  async begin(input: z.input<(typeof openAuthInputs)["open.auth.begin"]>) {
    const a = parse(openAuthInputs["open.auth.begin"], input),
      redirect = new URL(a.redirectUrl);
    if (redirect.protocol !== "https:" || redirect.username || redirect.password || redirect.hash)
      throw new KitError("INVALID_INPUT", "OAuth requires the registered HTTPS callback URL.");
    return this.locked(async (file) => {
      const state = randomBytes(32).toString("hex");
      const expiresAt = this.traffic.clock.now() + 600000;
      await this.save(`${this.file}.oauth-state.json`, { stateHash: digest(state), expiresAt });
      const url = new URL("https://account.bilibili.com/pc/account-pc/auth/oauth");
      url.search = new URLSearchParams({
        client_id: file.clientId,
        gourl: redirect.href,
        state,
      }).toString();
      return { url: url.href, expiresAt };
    });
  }
  private async token(file: AuthFile, fields: Record<string, string>, refresh: boolean) {
    const url = new URL(
      `/x/account-oauth2/v1/${refresh ? "refresh_token" : "token"}`,
      "https://api.bilibili.com",
    );
    url.search = new URLSearchParams({
      client_id: file.clientId,
      client_secret: file.appSecret,
      ...fields,
    }).toString();
    const raw = await this.traffic.request(
      url,
      { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } },
      `uid:${file.uid}`,
      false,
    );
    const result = tokenSchema.safeParse(raw);
    if (!result.success || result.data.expires_in * 1000 <= this.traffic.clock.now())
      throw new KitError(
        "UNKNOWN_OUTCOME",
        "OAuth response is missing valid tokens or UTC expiry; reauthorize.",
      );
    if (!refresh && !result.data.scopes)
      throw new KitError("UNKNOWN_OUTCOME", "OAuth authorization response is missing scopes.");
    const next = parse(openCredentialSchema, {
      ...file,
      accessToken: result.data.access_token,
      refreshToken: result.data.refresh_token,
      expiresAt: result.data.expires_in * 1000,
      scopes: result.data.scopes ?? file.scopes ?? [],
      refreshPending: false,
    });
    await this.save(this.file, next);
    return this.describe(next);
  }
  async exchange(input: z.input<(typeof openAuthInputs)["open.auth.exchange"]>) {
    const a = parse(openAuthInputs["open.auth.exchange"], input);
    return this.locked(async (file) => {
      let saved: { stateHash: string; expiresAt: number };
      try {
        saved = parse(
          z.object({ stateHash: z.string().length(64), expiresAt: z.number() }),
          JSON.parse(await readFile(`${this.file}.oauth-state.json`, "utf8")),
        );
      } catch {
        throw new KitError(
          "AUTH_REQUIRED",
          "Start a new OAuth authorization before exchanging a code.",
        );
      }
      if (
        saved.expiresAt <= this.traffic.clock.now() ||
        !timingSafeEqual(Buffer.from(saved.stateHash), Buffer.from(digest(a.state)))
      )
        throw new KitError("FORBIDDEN", "OAuth state mismatch or expiration.");
      await unlink(`${this.file}.oauth-state.json`);
      return this.token(file, { grant_type: "authorization_code", code: a.code }, false);
    });
  }
  async refresh() {
    return this.locked(async (file) => {
      if (
        !file.refreshToken ||
        file.refreshPending ||
        !file.expiresAt ||
        file.expiresAt <= this.traffic.clock.now()
      )
        throw new KitError(
          "AUTH_REQUIRED",
          "A current unused refresh token is required; reauthorize.",
        );
      await this.save(this.file, { ...file, refreshPending: true });
      try {
        return await this.token(
          file,
          { grant_type: "refresh_token", refresh_token: file.refreshToken },
          true,
        );
      } catch (error) {
        if (
          error instanceof KitError &&
          ["RATE_LIMITED", "TRAFFIC_PAUSED", "UPSTREAM"].includes(error.code)
        )
          await this.save(this.file, file);
        throw error;
      }
    });
  }
  async logout() {
    return this.locked(async (file) => {
      await this.save(this.file, {
        clientId: file.clientId,
        appSecret: file.appSecret,
        uid: file.uid,
        ...(file.openId ? { openId: file.openId } : {}),
      });
      await unlink(`${this.file}.oauth-state.json`).catch(() => {});
      return { cleared: true, remoteAuthorizationRevoked: false };
    });
  }
  async call(name: string, input: unknown) {
    if (!Object.hasOwn(openAuthInputs, name))
      throw new KitError("INVALID_INPUT", "Unknown OAuth management command.");
    const a = parse(openAuthInputs[name as keyof typeof openAuthInputs], input);
    if (name === "open.auth.begin")
      return this.begin(a as z.input<(typeof openAuthInputs)["open.auth.begin"]>);
    if (name === "open.auth.exchange")
      return this.exchange(a as z.input<(typeof openAuthInputs)["open.auth.exchange"]>);
    if (name === "open.auth.refresh") return this.refresh();
    if (name === "open.auth.logout") return this.logout();
    return this.status();
  }
}
