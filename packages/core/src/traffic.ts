import { randomUUID } from "node:crypto";
import type { Clock, State } from "./contracts.js";
import type { StateStore } from "./state.js";
import { KitError } from "./errors.js";

export const RISK_DEFAULTS = {
  minGapMs: 1500,
  readHourly: 600,
  readDaily: 3000,
  writeHourly: 12,
  writeDaily: 30,
  dmGapMs: 60000,
} as const;
export function checkPaused(state: State, account: string, now: number): void {
  if (state.traffic.manual[account])
    throw new KitError("TRAFFIC_PAUSED", "Account requires administrator login/captcha review.");
  if (state.traffic.until > now)
    throw new KitError("TRAFFIC_PAUSED", "Platform backoff is active; wait before retrying.");
}
export function parseJson(text: string): unknown {
  return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) {
      if (context?.source && /^-?\d+$/.test(context.source)) return context.source;
      throw new KitError("UPSTREAM", "Unsafe upstream integer.");
    }
    return value;
  }) as unknown;
}
export async function boundedBody(response: Response, limit = 8 * 1024 * 1024): Promise<Buffer> {
  if (!response.body) throw new KitError("UPSTREAM", "Empty upstream response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new KitError("UPSTREAM", "Upstream response exceeds size limit.");
      chunks.push(next.value);
    }
    return Buffer.concat(chunks);
  } catch {
    await reader.cancel().catch(() => {});
    throw new KitError("UPSTREAM", "Invalid or oversized upstream JSON.");
  }
}
export async function boundedJson(response: Response): Promise<unknown> {
  try {
    return parseJson((await boundedBody(response)).toString("utf8"));
  } catch {
    throw new KitError("UPSTREAM", "Invalid or oversized upstream JSON.");
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new KitError("UPSTREAM", "Unexpected upstream response shape.");
  return value as Record<string, unknown>;
}
export class Traffic {
  constructor(
    readonly store: StateStore,
    readonly clock: Clock,
    readonly fetcher: typeof fetch,
  ) {}
  async request(
    url: URL,
    init: RequestInit,
    account: string,
    authenticated: boolean,
    cdn = false,
    bodyOptions?: { format?: "bytes" | "text" | "location"; limit?: number; writeGroup?: string },
  ): Promise<unknown> {
    const writing = init.method === "POST";
    const token = randomUUID();
    const deadline = this.clock.now() + 30000;
    for (;;) {
      const acquired = await this.store.transaction((state) => {
        const now = this.clock.now();
        checkPaused(state, account, now);
        const t = state.traffic;
        if (t.active && t.active.until > now) return false;
        if (now - t.lastDispatch < RISK_DEFAULTS.minGapMs) return false;
        const a = (t.accounts[account] ??= {
          hourAt: now,
          dayAt: now,
          readHour: 0,
          readDay: 0,
          writeHour: 0,
          writeDay: 0,
          lastWrite: -1e12,
        });
        if (now - a.hourAt >= 3600000) {
          a.hourAt = now;
          a.readHour = 0;
          a.writeHour = 0;
        }
        if (now - a.dayAt >= 86400000) {
          a.dayAt = now;
          a.readDay = 0;
          a.writeDay = 0;
        }
        if (writing) {
          const gap = url.pathname.endsWith("/send_msg") ? RISK_DEFAULTS.dmGapMs : 0;
          const sameGroup =
            !!bodyOptions?.writeGroup && a.lastWriteGroup === bodyOptions.writeGroup;
          if (
            (!sameGroup && a.writeHour >= RISK_DEFAULTS.writeHourly) ||
            (!sameGroup && a.writeDay >= RISK_DEFAULTS.writeDaily) ||
            (now - a.lastWrite < gap &&
              (!bodyOptions?.writeGroup || a.lastWriteGroup !== bodyOptions.writeGroup))
          )
            throw new KitError("RATE_LIMITED", "Write budget or cooldown reached.");
          if (!sameGroup) {
            a.writeHour++;
            a.writeDay++;
          }
          a.lastWrite = now;
          if (bodyOptions?.writeGroup) a.lastWriteGroup = bodyOptions.writeGroup;
          else delete a.lastWriteGroup;
        } else {
          if (a.readHour >= RISK_DEFAULTS.readHourly || a.readDay >= RISK_DEFAULTS.readDaily)
            throw new KitError("RATE_LIMITED", "Read budget reached.");
          a.readHour++;
          a.readDay++;
        }
        t.lastDispatch = now;
        t.active = { token, until: now + 35000 };
        return true;
      });
      if (acquired) break;
      if (this.clock.now() >= deadline)
        throw new KitError("RATE_LIMITED", "Request queue is busy.");
      await this.clock.sleep(100);
    }
    try {
      const response = await this.fetcher(url, {
        ...init,
        redirect: bodyOptions?.format === "location" ? "manual" : "error",
        signal: AbortSignal.timeout(30000),
      });
      let payload: unknown;
      try {
        payload =
          bodyOptions?.format === "location"
            ? response.headers.get("location")
            : bodyOptions?.format
              ? await boundedBody(response, bodyOptions.limit)
              : await boundedJson(response);
        if (bodyOptions?.format === "text" && Buffer.isBuffer(payload))
          payload = payload.toString("utf8");
      } catch {
        payload = undefined;
      }
      const record =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : {};
      const code = typeof record.code === "number" ? record.code : undefined;
      const risk =
        [412, 429].includes(response.status) ||
        (code !== undefined && [-412, -352, -799, -509, -10403, 127009, 127306].includes(code));
      const manual =
        code === 12015 ||
        code === -105 ||
        (authenticated && (code === -101 || response.status === 401));
      const retry = response.headers.get("retry-after");
      const retryMs = retry
        ? /^\d+(\.\d+)?$/.test(retry)
          ? Number(retry) * 1000
          : Date.parse(retry) - this.clock.now()
        : 0;
      await this.store.transaction((state) => {
        if (risk) {
          const t = state.traffic;
          t.streak = Math.min(8, t.streak + 1);
          t.until = Math.max(
            t.until,
            this.clock.now() +
              Math.max(
                Number.isFinite(retryMs) ? retryMs : 0,
                Math.min(1800000, 300000 * 2 ** (t.streak - 1)),
              ),
          );
        }
        if (manual) state.traffic.manual[account] = true;
      });
      if (writing && (!response.ok || code === undefined))
        throw new KitError(
          "UNKNOWN_OUTCOME",
          "Write response is inconclusive; manual reconciliation required.",
        );
      if (risk || manual)
        throw new KitError("TRAFFIC_PAUSED", "Platform requested backoff or account review.");
      const redirect =
        bodyOptions?.format === "location" && [301, 302, 303, 307, 308].includes(response.status);
      if ((!response.ok && !redirect) || payload === undefined)
        throw new KitError("UPSTREAM", "Upstream did not return a successful JSON response.");
      const anonymousKeys =
        !authenticated && url.pathname === "/x/web-interface/nav" && code === -101;
      if (!cdn && code !== 0 && !anonymousKeys)
        throw new KitError(
          code === -101 ? "AUTH_REQUIRED" : "UPSTREAM",
          `Bilibili rejected the request (code ${String(code)}).`,
        );
      return cdn ? payload : record.data;
    } catch (error) {
      if (error instanceof KitError) throw error;
      throw new KitError(
        writing ? "UNKNOWN_OUTCOME" : "NETWORK",
        writing
          ? "Write outcome unknown; do not retry without reconciliation."
          : "Network request failed.",
      );
    } finally {
      await this.store.transaction((state) => {
        if (state.traffic.active?.token === token) delete state.traffic.active;
      });
    }
  }
}
