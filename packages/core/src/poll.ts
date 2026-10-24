import { randomUUID } from "node:crypto";
import { z } from "zod";
import { id, parse, type Cursor, type Message } from "./contracts.js";
import { BiliClient } from "./client.js";
import { KitError } from "./errors.js";
import { object } from "./traffic.js";
import { digest } from "./wbi.js";
import type { StateStore } from "./state.js";

function integerString(value: unknown): string {
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new KitError("UPSTREAM", "Unsafe message identifier; cursor preserved.");
  if (typeof value !== "string" && typeof value !== "number")
    throw new KitError("UPSTREAM", "Missing message identifier; cursor preserved.");
  const text = String(value);
  if (!/^\d+$/.test(text))
    throw new KitError("UPSTREAM", "Invalid message identifier; cursor preserved.");
  return text;
}
export function normalizeMessage(value: unknown): Message {
  const row = object(value);
  const ts = Number(row.timestamp),
    sender = integerString(row.sender_uid);
  if (!Number.isFinite(ts) || ts < 0)
    throw new KitError("UPSTREAM", "Invalid message timestamp; cursor preserved.");
  if (typeof row.content !== "string")
    throw new KitError("UPSTREAM", "Invalid message content; cursor preserved.");
  let text = row.content;
  try {
    const content = object(JSON.parse(text));
    const value = content.content ?? content.text;
    if (typeof value === "string") text = value;
  } catch {
    /* Plain text remains data. */
  }
  const seq = row.msg_seqno == null ? null : integerString(row.msg_seqno);
  const key =
    row.msg_key == null
      ? (seq ?? digest(JSON.stringify([ts, sender, text])))
      : integerString(row.msg_key);
  return { ts, sender, text, key, seq };
}
export class DmPoller {
  #client: BiliClient;
  #store: StateStore;
  constructor(client: BiliClient, store: StateStore) {
    this.#client = client;
    this.#store = store;
  }
  async peek(input: {
    uid: string;
  }): Promise<{ baseline: boolean; event: { receipt: string; message: Message } | null }> {
    const { uid } = parse(z.strictObject({ uid: id }), input);
    this.#client.requireTrustedDm(uid);
    const session = await this.#client.session(true),
      key = `${session.account}:dm:${uid}`;
    const before = (await this.#store.snapshot()).cursors[key];
    if (before?.pending[0]) return { baseline: false, event: before.pending[0] };
    const seen = new Set<string>(),
      all: Message[] = [];
    let cursor = "0";
    for (let page = 0; page < 10; page++) {
      const data = object(await this.#client.dmHistory({ uid, beforeSeq: cursor }, session));
      if (!Array.isArray(data.messages))
        throw new KitError("UPSTREAM", "Missing history messages; cursor preserved.");
      const rows = data.messages.map(normalizeMessage);
      for (const row of rows)
        if (!seen.has(row.key)) {
          seen.add(row.key);
          all.push(row);
        }
      const more = data.has_more;
      if (
        !before ||
        rows.some((r) => r.ts < before.lastSeen) ||
        more === 0 ||
        more === "0" ||
        more === false ||
        (more === undefined && rows.length < 30)
      )
        break;
      const seqs = rows.flatMap((row) => (row.seq ? [BigInt(row.seq)] : []));
      if (!seqs.length)
        throw new KitError("UPSTREAM", "Pagination lacks sequence numbers; cursor preserved.");
      const next = seqs.reduce((a, b) => (a < b ? a : b)).toString();
      if (next === cursor || (cursor !== "0" && BigInt(next) >= BigInt(cursor)) || page === 9)
        throw new KitError(
          "UPSTREAM",
          "History pagination stalled or exceeded 10 pages; cursor preserved.",
        );
      cursor = next;
    }
    all.sort(
      (a, b) =>
        a.ts - b.ts ||
        (a.seq && b.seq
          ? BigInt(a.seq) < BigInt(b.seq)
            ? -1
            : BigInt(a.seq) > BigInt(b.seq)
              ? 1
              : 0
          : a.key.localeCompare(b.key)),
    );
    const boundary = before?.lastSeen ?? 0,
      known = new Set(before?.lastKeys ?? []);
    const fresh = before
      ? all.filter(
          (row) =>
            row.sender === uid &&
            (row.ts > boundary || (row.ts === boundary && !known.has(row.key))),
        )
      : [];
    const newest = Math.max(boundary, ...all.map((row) => row.ts));
    const keys = [
      ...new Set([
        ...(newest === boundary ? known : []),
        ...all.filter((row) => row.ts === newest).map((row) => row.key),
      ]),
    ];
    if (keys.length > 10000)
      throw new KitError("STATE_BUSY", "Timestamp boundary exceeds safe cursor capacity.");
    return this.#store.transaction((state) => {
      const current = state.cursors[key];
      if (current?.revision !== before?.revision)
        throw new KitError("CONFLICT", "Cursor changed concurrently; poll again.");
      const next: Cursor = {
        revision: (before?.revision ?? 0) + 1,
        lastSeen: newest,
        lastKeys: keys,
        pending: fresh.map((message) => ({ receipt: randomUUID(), message })),
      };
      state.cursors[key] = next;
      return { baseline: !before, event: next.pending[0] ?? null };
    });
  }
  async ack(input: { uid: string; receipt: string }): Promise<{ acknowledged: true }> {
    const { uid, receipt } = parse(z.strictObject({ uid: id, receipt: z.string().uuid() }), input);
    this.#client.requireTrustedDm(uid);
    const session = await this.#client.session(true),
      key = `${session.account}:dm:${uid}`;
    return this.#store.transaction((state) => {
      const cursor = state.cursors[key];
      if (!cursor || cursor.pending[0]?.receipt !== receipt)
        throw new KitError("CONFLICT", "Receipt does not match the next pending event.");
      cursor.pending.shift();
      cursor.revision++;
      return { acknowledged: true };
    });
  }
}
