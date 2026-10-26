import { constants, publicEncrypt, randomUUID } from "node:crypto";
import { lstat, readFile, rename, unlink } from "node:fs/promises";
import { z } from "zod";
import { credentialSchema, parse, type Credentials } from "./contracts.js";
import { QrLogin, cookieHeader, checkCancelled } from "./auth.js";
import { FileCredentials, writePrivateFile } from "./credentials.js";
import { boundedBody, boundedJson, object, checkPaused } from "./traffic.js";
import { KitError } from "./errors.js";
import { digest } from "./wbi.js";
import { bindIdentity } from "./identity.js";
import type { StateStore } from "./state.js";

const PASSPORT = "https://passport.bilibili.com";
const KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDLgd2OAkcGVtoE3ThUREbio0Eg
Uc/prcajMKXvkCKFCWhJYJcLkcM2DKKcSeFpD/j6Boy538YXnR6VhcuUJOhH2x71
nzPjfdTcqMz7djHum0qSZA0AyCBDABUqCrfNgCiJ00Ra7GmRj+YCK1NJEuewlb40
JNrRuoEUXpabUzGB8QIDAQAB
-----END PUBLIC KEY-----`;
const journalSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("requesting"), uid: z.string(), original: z.string() }),
  z.object({
    phase: z.literal("received"),
    uid: z.string(),
    original: z.string(),
    credentials: credentialSchema,
    previousToken: z.string(),
  }),
]);
type Journal = z.infer<typeof journalSchema>;

/** Trusted host protocol; never expose return credentials to MCP. */
export class CookieRefresh {
  constructor(readonly protocol = new QrLogin()) {}
  async request(
    url: URL,
    credentials: Credentials,
    fields?: Record<string, string>,
    html = false,
    signal?: AbortSignal,
  ): Promise<{ data: unknown; response: Response }> {
    checkCancelled(signal);
    if (
      ![PASSPORT, "https://www.bilibili.com"].includes(url.origin) ||
      url.username ||
      url.password
    )
      throw new KitError("FORBIDDEN", "Unexpected refresh origin.");
    try {
      const response = await this.protocol.fetcher(url, {
        method: fields ? "POST" : "GET",
        redirect: "error",
        headers: {
          "user-agent": "Mozilla/5.0",
          referer: "https://www.bilibili.com/",
          cookie: cookieHeader(credentials),
          ...(fields ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        },
        ...(fields ? { body: new URLSearchParams(fields).toString() } : {}),
        signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
      });
      if (html) {
        if (!response.ok) throw new KitError("UPSTREAM", "Refresh challenge was rejected.");
        return { response, data: (await boundedBody(response, 1024 * 1024)).toString("utf8") };
      }
      let body: Record<string, unknown>;
      try {
        body = object(await boundedJson(response));
      } catch {
        throw new KitError(fields ? "UNKNOWN_OUTCOME" : "UPSTREAM", "Invalid refresh response.");
      }
      if (
        [412, 429].includes(response.status) ||
        [-412, -352, -799, -509, -10403, -105, 12015].includes(Number(body.code))
      )
        throw new KitError("TRAFFIC_PAUSED", "Cookie refresh requires platform review.");
      if (!response.ok || typeof body.code !== "number")
        throw new KitError(
          fields ? "UNKNOWN_OUTCOME" : "UPSTREAM",
          "Refresh response is inconclusive.",
        );
      if (body.code !== 0)
        throw new KitError(
          body.code === -101 ? "AUTH_REQUIRED" : "UPSTREAM",
          "Cookie refresh was rejected.",
        );
      return { response, data: body.data };
    } catch (error) {
      if (error instanceof KitError) throw error;
      throw new KitError(
        fields ? "UNKNOWN_OUTCOME" : "NETWORK",
        "Cookie refresh request did not complete.",
      );
    }
  }
  async check(
    credentials: Credentials,
    signal?: AbortSignal,
  ): Promise<{ refresh: boolean; timestamp: number }> {
    const url = new URL("/x/passport-login/web/cookie/info", PASSPORT);
    url.searchParams.set("csrf", credentials.bili_jct);
    const { data } = await this.request(url, credentials, undefined, false, signal);
    return parse(z.object({ refresh: z.boolean(), timestamp: z.number().int().positive() }), data);
  }
  async challenge(
    credentials: Credentials,
    timestamp: number,
    signal?: AbortSignal,
  ): Promise<string> {
    const path = publicEncrypt(
      { key: KEY, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      Buffer.from(`refresh_${timestamp}`),
    ).toString("hex");
    const { data } = await this.request(
      new URL(`/correspond/1/${path}`, "https://www.bilibili.com"),
      credentials,
      undefined,
      true,
      signal,
    );
    const csrf = String(data)
      .match(/<div\s+id=["']1-name["']\s*>([^<]+)<\/div>/)?.[1]
      ?.trim();
    if (!csrf || csrf.length > 256)
      throw new KitError("UPSTREAM", "Missing refresh CSRF challenge.");
    return csrf;
  }
  async rotate(
    credentials: Credentials,
    challenge: string,
    signal?: AbortSignal,
  ): Promise<Credentials> {
    if (!credentials.refresh_token)
      throw new KitError("AUTH_REQUIRED", "Sign in with QR again to obtain a refresh token.");
    const { response, data } = await this.request(
      new URL("/x/passport-login/web/cookie/refresh", PASSPORT),
      credentials,
      {
        csrf: credentials.bili_jct,
        refresh_csrf: challenge,
        source: "main_web",
        refresh_token: credentials.refresh_token,
      },
      false,
      signal,
    );
    const cookies: Record<string, string> = {};
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";", 1)[0] ?? "",
        index = pair.indexOf("=");
      if (index > 0) cookies[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
    }
    const parsed = credentialSchema.safeParse({
      sessdata: cookies.SESSDATA,
      bili_jct: cookies.bili_jct,
      refresh_token: object(data).refresh_token,
      ...(cookies.buvid3 || credentials.buvid3
        ? { buvid3: cookies.buvid3 ?? credentials.buvid3 }
        : {}),
    });
    if (!parsed.success || !parsed.data.refresh_token)
      throw new KitError(
        "UNKNOWN_OUTCOME",
        "Refresh response is missing new credentials; sign in again.",
      );
    return parsed.data;
  }
  async confirm(
    credentials: Credentials,
    previousToken: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request(
      new URL("/x/passport-login/web/confirm/refresh", PASSPORT),
      credentials,
      { csrf: credentials.bili_jct, refresh_token: previousToken },
      false,
      signal,
    );
  }
}

/** Durable journal contains secrets and is private like the credential file. */
export async function refreshCredentials(
  file: FileCredentials,
  store: StateStore,
  protocol: QrLogin,
  signal?: AbortSignal,
): Promise<{ refreshed: boolean; confirmed: boolean }> {
  const refresh = new CookieRefresh(protocol),
    path = `${file.path}.refresh.json`;
  const save = async (journal: Journal) => {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writePrivateFile(temporary, JSON.stringify(journal));
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  };
  let refreshed = false;
  await file.update(async (previous, checkpoint) => {
    if (!previous) throw new KitError("AUTH_REQUIRED", "Sign in before refreshing.");
    let journal: Journal | undefined;
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.size > 32768)
        throw new KitError("STATE_INVALID", "Invalid refresh journal.");
      journal = parse(journalSchema, JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    if (journal?.phase === "requesting")
      throw new KitError(
        "UNKNOWN_OUTCOME",
        "Previous refresh may have succeeded; sign in with QR again.",
      );
    if (!journal) {
      const account = await protocol.verify(previous, signal);
      await bindIdentity(store, digest(previous.sessdata), account.uid, protocol.clock.now());
      checkPaused(await store.snapshot(), `uid:${account.uid}`, protocol.clock.now());
      const info = await refresh.check(previous, signal);
      if (!info.refresh) return previous;
      if (!previous.refresh_token)
        throw new KitError("AUTH_REQUIRED", "Sign in with QR again to obtain a refresh token.");
      const challenge = await refresh.challenge(previous, info.timestamp, signal);
      const pending: Journal = {
        phase: "requesting",
        uid: account.uid,
        original: digest(previous.sessdata),
      };
      await save(pending);
      let credentials: Credentials;
      try {
        credentials = await refresh.rotate(previous, challenge, signal);
      } catch (error) {
        if (
          error instanceof KitError &&
          ["UPSTREAM", "AUTH_REQUIRED", "TRAFFIC_PAUSED", "CANCELLED"].includes(error.code)
        )
          await unlink(path);
        throw error;
      }
      journal = {
        ...pending,
        phase: "received",
        credentials,
        previousToken: previous.refresh_token,
      };
      await save(journal);
    }
    if (
      ![journal.original, digest(journal.credentials.sessdata)].includes(digest(previous.sessdata))
    )
      throw new KitError(
        "CONFLICT",
        "Refresh journal belongs to a different session; sign in again.",
      );
    const account = await protocol.verify(journal.credentials, signal);
    if (account.uid !== journal.uid)
      throw new KitError("AUTH_REQUIRED", "Refreshed session changed the account.");
    await bindIdentity(
      store,
      digest(journal.credentials.sessdata),
      account.uid,
      protocol.clock.now(),
    );
    await checkpoint(journal.credentials);
    await refresh.confirm(journal.credentials, journal.previousToken, signal);
    await unlink(path);
    refreshed = true;
    return journal.credentials;
  });
  return { refreshed, confirmed: refreshed };
}
