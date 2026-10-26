import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { parse, type Clock } from "./contracts.js";
import { openCredentialSchema, type OpenCredentials, type OpenOptions } from "./open-platform.js";
import type { StateStore } from "./state.js";
import { KitError } from "./errors.js";
import { scrub } from "./client.js";
import { digest } from "./wbi.js";

export const openEventInput = z.strictObject({ source: z.enum(["webhook", "live"]) });
export const openEventAckInput = openEventInput.extend({ receipt: z.string().uuid() });
const messageSchema = z.object({
  event: z.string().min(1).max(100),
  content: z.record(z.string(), z.unknown()),
  timestamp: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
});

export class OpenEvents {
  constructor(
    readonly store: StateStore,
    readonly clock: Clock,
    readonly options?: OpenOptions,
  ) {}
  private async credentials() {
    let value: unknown;
    try {
      value = await this.options?.credentials();
    } catch {
      throw new KitError("AUTH_REQUIRED", "Open event credentials are unavailable.");
    }
    if (!value)
      throw new KitError("AUTH_REQUIRED", "Independent open platform credentials are required.");
    return parse(openCredentialSchema, value);
  }
  private key(source: "webhook" | "live", credentials: OpenCredentials) {
    if (source === "webhook" && !credentials.openId)
      throw new KitError(
        "AUTH_REQUIRED",
        "Configure the authorized user's openId before accepting account callbacks.",
      );
    return digest(
      JSON.stringify([
        source,
        credentials.clientId,
        source === "webhook" ? credentials.openId : credentials.uid,
      ]),
    );
  }
  private async enqueue(
    source: "webhook" | "live",
    credentials: OpenCredentials,
    identity: string,
    event: unknown,
  ) {
    if (!this.store.durable)
      throw new KitError("FORBIDDEN", "Official push events require durable state.");
    const key = this.key(source, credentials);
    const safe = scrub(event, {
      app_secret: credentials.appSecret,
      access_token: credentials.accessToken,
      refresh_token: credentials.refreshToken,
    });
    if (Buffer.byteLength(JSON.stringify(safe)) > 1024 * 1024)
      throw new KitError("UPSTREAM", "Official event exceeds the size limit.");
    return this.store.transaction((state) => {
      const queue = (state.openEvents[key] ??= { seen: [], pending: [] });
      if (queue.seen.includes(identity)) return { accepted: true, duplicate: true };
      if (queue.pending.length >= 1000)
        throw new KitError(
          "STATE_BUSY",
          "Official event queue is full; consume pending receipts first.",
        );
      queue.pending.push({
        receipt: randomUUID(),
        key: identity,
        event: safe,
        receivedAt: this.clock.now(),
      });
      queue.seen = [...queue.seen, identity].slice(-10000);
      return { accepted: true, duplicate: false };
    });
  }
  /** Host HTTPS handlers pass exact raw bytes and the x-bilibili-signature header. */
  async receiveWebhook(rawBody: string | Uint8Array, signature: string) {
    const credentials = await this.credentials(),
      bytes = Buffer.from(rawBody);
    if (!bytes.length || bytes.length > 1024 * 1024 || !/^[a-f0-9]{40}$/i.test(signature))
      throw new KitError("FORBIDDEN", "Invalid webhook signature or body size.");
    const expected = createHash("sha1").update(credentials.appSecret).update(bytes).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
      throw new KitError("FORBIDDEN", "Webhook signature does not match the raw body.");
    let raw: unknown;
    try {
      raw = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new KitError("INVALID_INPUT", "Webhook body is not JSON.");
    }
    const message = parse(messageSchema, raw);
    if (message.event === "verify_webhooks") {
      const data = parse(
        z.union([z.string().max(1000), z.number().finite()]),
        message.content.data,
      );
      return { data };
    }
    if (
      message.content.client_id !== credentials.clientId ||
      !credentials.openId ||
      message.content.openid !== credentials.openId
    )
      throw new KitError("FORBIDDEN", "Webhook application or user does not match this account.");
    if (!["video_open", "video_fail"].includes(message.event))
      return { accepted: false, ignored: true };
    return this.enqueue("webhook", credentials, digest(bytes.toString("utf8")), message);
  }
  /** Trusted connection adapter only; this ingestion method is not exposed to MCP. */
  async receiveLive(credentials: OpenCredentials, event: unknown) {
    return this.enqueue("live", credentials, digest(JSON.stringify(event)), event);
  }
  async peek(input: z.input<typeof openEventInput>) {
    const a = parse(openEventInput, input),
      key = this.key(a.source, await this.credentials());
    return { event: (await this.store.snapshot()).openEvents[key]?.pending[0] ?? null };
  }
  async ack(input: z.input<typeof openEventAckInput>) {
    const a = parse(openEventAckInput, input),
      key = this.key(a.source, await this.credentials());
    return this.store.transaction((state) => {
      const queue = state.openEvents[key];
      if (queue?.pending[0]?.receipt !== a.receipt)
        throw new KitError("CONFLICT", "Receipt is not the next pending official event.");
      queue.pending.shift();
      return { acknowledged: true };
    });
  }
}
