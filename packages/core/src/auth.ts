import { credentialSchema, parse, systemClock, type Clock, type Credentials } from "./contracts.js";
import { KitError } from "./errors.js";
import { boundedJson, object } from "./traffic.js";

const PASSPORT = "https://passport.bilibili.com";
export interface LoginAccount {
  uid: string;
  name: string;
}
export interface QrChallenge {
  url: string;
  key: string;
  expiresAt: number;
}
export type QrResult =
  | { status: "waiting" | "scanned" | "expired" }
  | { status: "success"; account: LoginAccount; credentials: Credentials };
export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new KitError("CANCELLED", "Login cancelled.");
}
export function loginAccount(value: unknown): LoginAccount {
  const nav = object(value);
  if (
    nav.isLogin !== true ||
    !(
      (typeof nav.mid === "number" && Number.isSafeInteger(nav.mid) && nav.mid > 0) ||
      (typeof nav.mid === "string" && /^[1-9]\d{0,19}$/.test(nav.mid))
    )
  )
    throw new KitError("AUTH_REQUIRED", "Account login could not be verified.");
  return { uid: String(nav.mid), name: typeof nav.uname === "string" ? nav.uname : "" };
}
export function cookieHeader(c: Credentials): string {
  return `SESSDATA=${c.sessdata}; bili_jct=${c.bili_jct}${c.buvid3 ? `; buvid3=${c.buvid3}` : ""}`;
}
/** Trusted host API. Success contains credentials; never serialize it into agent tool output. */
export class QrLogin {
  readonly clock: Clock;
  readonly fetcher: typeof fetch;
  #nextRequest = 0;
  constructor(options: { clock?: Clock; fetch?: typeof fetch } = {}) {
    this.clock = options.clock ?? systemClock;
    this.fetcher = options.fetch ?? globalThis.fetch;
  }
  async #request(
    url: URL,
    signal?: AbortSignal,
    credentials?: Credentials,
  ): Promise<{ data: unknown; response: Response }> {
    checkCancelled(signal);
    const wait = Math.max(0, this.#nextRequest - this.clock.now());
    // Reserve before awaiting so concurrent calls also respect the polling interval.
    this.#nextRequest = this.clock.now() + wait + 2000;
    if (wait) await this.clock.sleep(wait);
    checkCancelled(signal);
    try {
      const response = await this.fetcher(url, {
        redirect: "error",
        signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
        headers: {
          "user-agent": "Mozilla/5.0",
          referer: `${PASSPORT}/login`,
          ...(credentials ? { cookie: cookieHeader(credentials) } : {}),
        },
      });
      const body = object(await boundedJson(response));
      if (
        [412, 429].includes(response.status) ||
        [-412, -352, -799, -509, -10403, -105, 12015].includes(Number(body.code))
      )
        throw new KitError("TRAFFIC_PAUSED", "Login requires platform review; try again later.");
      if (response.status === 401 || body.code === -101)
        throw new KitError("AUTH_REQUIRED", "Login has expired.");
      if (!response.ok || body.code !== 0)
        throw new KitError("UPSTREAM", "Login request was rejected.");
      checkCancelled(signal);
      return { data: body.data, response };
    } catch (error) {
      checkCancelled(signal);
      if (error instanceof KitError) throw error;
      throw new KitError("NETWORK", "Login request failed.");
    }
  }
  async generate(signal?: AbortSignal): Promise<QrChallenge> {
    const { data } = await this.#request(
      new URL("/x/passport-login/web/qrcode/generate", PASSPORT),
      signal,
    );
    const raw = object(data);
    if (
      typeof raw.url !== "string" ||
      typeof raw.qrcode_key !== "string" ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(raw.qrcode_key)
    )
      throw new KitError("UPSTREAM", "Invalid QR challenge.");
    let url: URL;
    try {
      url = new URL(raw.url);
    } catch {
      throw new KitError("UPSTREAM", "Invalid QR URL.");
    }
    if (
      ![PASSPORT, "https://account.bilibili.com"].includes(url.origin) ||
      url.username ||
      url.password
    )
      throw new KitError("UPSTREAM", "Unexpected QR origin.");
    return { url: url.href, key: raw.qrcode_key, expiresAt: this.clock.now() + 180000 };
  }
  async verify(credentials: Credentials, signal?: AbortSignal): Promise<LoginAccount> {
    const { data } = await this.#request(
      new URL("https://api.bilibili.com/x/web-interface/nav"),
      signal,
      parse(credentialSchema, credentials),
    );
    const account = loginAccount(data);
    for (const secret of Object.values(credentials))
      if (secret) account.name = account.name.split(secret).join("[redacted]");
    return account;
  }
  async poll(qr: QrChallenge, signal?: AbortSignal): Promise<QrResult> {
    checkCancelled(signal);
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(qr.key) || !Number.isFinite(qr.expiresAt))
      throw new KitError("INVALID_INPUT", "Invalid QR challenge.");
    if (this.clock.now() >= qr.expiresAt) return { status: "expired" };
    const url = new URL("/x/passport-login/web/qrcode/poll", PASSPORT);
    url.searchParams.set("qrcode_key", qr.key);
    const { data, response } = await this.#request(url, signal);
    const code = object(data).code;
    if (code === 86101) return { status: "waiting" };
    if (code === 86090) return { status: "scanned" };
    if (code === 86038) return { status: "expired" };
    if (code !== 0) throw new KitError("UPSTREAM", "Unexpected QR login state.");
    const cookies: Record<string, string> = {};
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";", 1)[0] ?? "";
      const equals = pair.indexOf("=");
      const name = pair.slice(0, equals).trim();
      if (["SESSDATA", "bili_jct", "buvid3"].includes(name))
        cookies[name] = pair.slice(equals + 1).trim();
    }
    const parsed = credentialSchema.safeParse({
      sessdata: cookies.SESSDATA,
      bili_jct: cookies.bili_jct,
      ...(cookies.buvid3 ? { buvid3: cookies.buvid3 } : {}),
    });
    if (!parsed.success)
      throw new KitError("AUTH_REQUIRED", "Login response did not provide valid credentials.");
    return {
      status: "success",
      account: await this.verify(parsed.data, signal),
      credentials: parsed.data,
    };
  }
}
