import { upstreamText } from "./models.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { BiliClient, scrub } from "./client.js";
import { ContentReads } from "./reads.js";
import { id, parse, type Message } from "./contracts.js";
import type { StateStore } from "./state.js";
import { object } from "./traffic.js";
import { upstreamId } from "./references.js";
import { KitError } from "./errors.js";
import { digest } from "./wbi.js";

export const eventInput = z.strictObject({
  source: z.enum(["reply", "at", "like", "live", "comments"]),
  roomId: id.optional(),
  oid: id.optional(),
  root: id.optional(),
});
export const eventAckInput = eventInput.extend({ receipt: z.string().uuid() });
export type EventMessage = Message & { data: unknown };
export class EventPoller {
  constructor(
    readonly client: BiliClient,
    readonly store: StateStore,
    readonly reads: ContentReads,
  ) {}
  private async scope(input: z.input<typeof eventInput>) {
    const args = parse(eventInput, input);
    if (args.source === "live" && !args.roomId)
      throw new KitError("INVALID_INPUT", "Live events require a canonical roomId.");
    if (args.source !== "live" && args.roomId)
      throw new KitError("INVALID_INPUT", "roomId only applies to live events.");
    if (args.source === "comments" && !args.oid)
      throw new KitError("INVALID_INPUT", "Comment events require a video aid as oid.");
    if (args.source !== "comments" && (args.oid || args.root))
      throw new KitError("INVALID_INPUT", "oid and root only apply to comment events.");
    const session = await this.client.session(true);
    return {
      args,
      session,
      key: `${session.account}:${args.source}:${args.roomId ?? (args.oid ? `${args.oid}:${args.root ?? "top"}` : "inbox")}`,
    };
  }
  async peek(input: z.input<typeof eventInput>) {
    const { args, key, session } = await this.scope(input);
    const client = new BiliClient(
      this.client.traffic,
      async () => session.credentials,
      this.client.policy,
    );
    const reads = new ContentReads(client);
    const coverage = args.source === "live" ? "recent_snapshot_only" : "bounded_inbox_pages";
    const before = (await this.store.snapshot()).events[key];
    if (before?.pending[0]) return { baseline: false, event: before.pending[0], coverage };
    const rows: EventMessage[] = [];
    if (args.source === "live") {
      const room = await client.liveInfo({ roomId: args.roomId! });
      if (String(room.room_id) !== args.roomId)
        throw new KitError("INVALID_INPUT", "Resolve the canonical live room ID first.");
      const history = await client.liveHistory({ roomId: args.roomId! });
      for (const row of history.room) {
        const identity =
          row.id_str ?? row.id ?? digest(JSON.stringify([row.uid, row.timeline, row.text]));
        const ts = Date.parse(String(row.timeline ?? "").replace(" ", "T") + "+08:00") / 1000;
        rows.push({
          key:
            typeof identity === "string" || typeof identity === "number"
              ? String(identity)
              : digest(JSON.stringify(identity)),
          seq: null,
          ts: Number.isFinite(ts) ? ts : 0,
          sender: String(row.uid ?? ""),
          text: row.text,
          data: row,
        });
      }
    } else if (args.source === "comments") {
      for (let page = 1; page <= 10; page++) {
        const data = object(
          scrub(
            await client.get(args.root ? "/x/v2/reply/reply" : "/x/v2/reply", {
              type: 1,
              oid: args.oid!,
              pn: page,
              ps: 20,
              sort: 0,
              ...(args.root ? { root: args.root } : {}),
            }),
            session.credentials,
          ),
        );
        if (data.replies !== null && !Array.isArray(data.replies))
          throw new KitError("UPSTREAM", "Missing comments; cursor preserved.");
        const replies = (data.replies ?? []) as unknown[];
        const pageRows = replies.map((raw) => {
          const row = object(raw),
            content = object(row.content);
          const ts = Number(row.ctime);
          if (!Number.isFinite(ts) || ts < 0)
            throw new KitError("UPSTREAM", "Invalid comment timestamp.");
          return {
            key: upstreamId(row.rpid),
            seq: null,
            ts,
            sender: upstreamId(row.mid),
            text: upstreamText(content.message),
            data: row,
          };
        });
        rows.push(...pageRows);
        if (
          replies.length < 20 ||
          (!args.root && (!before || pageRows.some((row) => before.seen.includes(row.key))))
        )
          break;
        if (page === 10)
          throw new KitError(
            "UPSTREAM",
            "Comment pagination exceeded ten pages without reaching the previous baseline; cursor preserved.",
          );
      }
    } else {
      let cursorId: string | undefined, cursorTime: number | undefined;
      const cursors = new Set<string>();
      for (let page = 0; page < 10; page++) {
        const data = object(
          await reads.call("notifications", {
            kind: args.source,
            ...(cursorId ? { cursorId } : {}),
            ...(cursorTime !== undefined ? { cursorTime } : {}),
          }),
        );
        // The like inbox has separate latest/total sections, each with its own list.
        const section = args.source === "like" && data.total ? object(data.total) : data;
        const latest = args.source === "like" && data.latest ? object(data.latest).items : [];
        if (!Array.isArray(section.items) || (latest !== undefined && !Array.isArray(latest)))
          throw new KitError("UPSTREAM", "Missing notification list; cursor preserved.");
        for (const raw of [...(Array.isArray(latest) ? latest : []), ...section.items]) {
          const row = object(raw),
            item = row.item ? object(row.item) : {};
          const ts = Number(row.reply_time ?? row.at_time ?? row.like_time ?? 0);
          if (!Number.isFinite(ts) || ts < 0)
            throw new KitError("UPSTREAM", "Invalid notification timestamp.");
          const user = row.user ? object(row.user) : {};
          rows.push({
            key: upstreamId(row.id),
            seq: null,
            ts,
            sender: user.mid === undefined ? "" : upstreamId(user.mid),
            text: upstreamText(item.source_content ?? item.title),
            data: row,
          });
        }
        const cursor = section.cursor ? object(section.cursor) : undefined;
        if (
          !before ||
          section.items.some((raw) => before.seen.includes(upstreamId(object(raw).id)))
        )
          break;
        if (!cursor || cursor.is_end === true || cursor.is_end === 1) break;
        const nextId = upstreamId(cursor.id),
          nextTime = Number(cursor.time);
        const next = `${nextId}:${nextTime}`;
        if (page === 9 || !Number.isFinite(nextTime) || nextTime < 0 || cursors.has(next))
          throw new KitError(
            "UPSTREAM",
            "Notification pagination stalled or exceeded ten pages; cursor preserved.",
          );
        cursors.add(next);
        cursorId = nextId;
        cursorTime = nextTime;
      }
    }
    const unique = [...new Map(rows.map((row) => [row.key, row])).values()].sort(
      (a, b) => a.ts - b.ts || a.key.localeCompare(b.key),
    );
    const seen = new Set(before?.seen ?? []);
    const fresh = before
      ? unique.filter((row) => !seen.has(row.key) && row.ts >= before.since)
      : [];
    return this.store.transaction((state) => {
      if (state.events[key]?.revision !== before?.revision)
        throw new KitError("CONFLICT", "Event cursor changed; poll again.");
      const next = {
        revision: (before?.revision ?? 0) + 1,
        since: before?.since ?? Math.max(0, ...unique.map((row) => row.ts)),
        seen: [...new Set([...(before?.seen ?? []), ...unique.map((row) => row.key)])].slice(
          -10000,
        ),
        pending: fresh.map((message) => ({ receipt: randomUUID(), message })),
      };
      state.events[key] = next;
      return { baseline: !before, event: next.pending[0] ?? null, coverage };
    });
  }
  async ack(input: z.input<typeof eventAckInput>) {
    const a = parse(eventAckInput, input);
    const { key } = await this.scope({
      source: a.source,
      ...(a.roomId ? { roomId: a.roomId } : {}),
      ...(a.oid ? { oid: a.oid } : {}),
      ...(a.root ? { root: a.root } : {}),
    });
    return this.store.transaction((state) => {
      const cursor = state.events[key];
      if (cursor?.pending[0]?.receipt !== a.receipt)
        throw new KitError("CONFLICT", "Receipt is not the next pending event.");
      cursor.pending.shift();
      cursor.revision++;
      return { acknowledged: true as const };
    });
  }
}
