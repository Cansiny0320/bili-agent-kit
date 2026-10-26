import { inflateSync } from "node:zlib";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { OpenPlatform, type OpenSession } from "./open-platform.js";
import { OpenEvents } from "./open-events.js";
import { KitError } from "./errors.js";
import { parse } from "./contracts.js";
import { parseJson, object } from "./traffic.js";

const MAX_PACKET = 8 * 1024 * 1024;
export function encodeLivePacket(
  operation: number,
  body: string | Uint8Array = "",
  version = 0,
): Buffer<ArrayBuffer> {
  const payload = Buffer.from(body),
    packet = Buffer.alloc(16 + payload.length);
  packet.writeUInt32BE(packet.length, 0);
  packet.writeUInt16BE(16, 4);
  packet.writeUInt16BE(version, 6);
  packet.writeUInt32BE(operation, 8);
  packet.writeUInt32BE(1, 12);
  payload.copy(packet, 16);
  return packet;
}
export function decodeLivePackets(bytes: Uint8Array): { operation: number; body: Buffer }[] {
  const packets: { operation: number; body: Buffer }[] = [];
  let expanded = 0;
  const decode = (data: Buffer, depth: number) => {
    expanded += data.length;
    if (expanded > MAX_PACKET || depth > 3)
      throw new KitError("UPSTREAM", "Live packet expansion limit exceeded.");
    for (let offset = 0; offset < data.length;) {
      if (data.length - offset < 16)
        throw new KitError("UPSTREAM", "Incomplete live packet header.");
      const length = data.readUInt32BE(offset),
        header = data.readUInt16BE(offset + 4),
        version = data.readUInt16BE(offset + 6),
        operation = data.readUInt32BE(offset + 8);
      if (header !== 16 || length < header || offset + length > data.length)
        throw new KitError("UPSTREAM", "Invalid live packet length.");
      const body = data.subarray(offset + header, offset + length);
      if (version === 2) {
        let unpacked: Buffer;
        try {
          unpacked = inflateSync(body, { maxOutputLength: MAX_PACKET - expanded });
        } catch {
          throw new KitError("UPSTREAM", "Invalid compressed live packet.");
        }
        decode(unpacked, depth + 1);
      } else if (version === 0 || version === 1) {
        if (packets.length >= 10000)
          throw new KitError("UPSTREAM", "Too many live packets in one frame.");
        packets.push({ operation, body });
      } else throw new KitError("UNAVAILABLE", "Unsupported official live packet version.");
      offset += length;
    }
  };
  decode(Buffer.from(bytes), 0);
  return packets;
}
export type LiveSocket = Pick<
  WebSocket,
  "readyState" | "binaryType" | "send" | "close" | "addEventListener" | "removeEventListener"
>;
export interface LiveRunOptions {
  signal: AbortSignal;
  maxReconnects?: number;
  socketFactory?: (url: string) => LiveSocket;
}
const startSchema = z.object({
  conn_id: z.string().min(1).max(256),
  websocket_info: z.object({
    auth_body: z.string().min(1).max(16384),
    wss_link: z.array(z.url()).min(1).max(20),
  }),
});

/** Long-lived, explicitly started host adapter. Model-facing operations only consume the queue. */
export class OpenLive {
  #running = false;
  constructor(
    readonly open: OpenPlatform,
    readonly events: OpenEvents,
  ) {}
  async run(
    options: LiveRunOptions,
  ): Promise<{ stopped: true; eventsReceived: number; reconnects: number }> {
    if (this.#running) throw new KitError("STATE_BUSY", "This live adapter is already running.");
    const maxReconnects = parse(z.number().int().min(0).max(10), options.maxReconnects ?? 3);
    if (!this.events.store.durable)
      throw new KitError("FORBIDDEN", "Official live events require durable state.");
    let eventsReceived = 0,
      reconnects = 0;
    this.#running = true;
    try {
      while (!options.signal.aborted) {
        try {
          const session = await this.open.session("LIVE_ROOM_DATA");
          const start = startSchema.safeParse(
            await this.open.request(session, "/arcopen/fn/live/room/ws-start", "POST"),
          );
          if (!start.success)
            throw new KitError("UPSTREAM", "Invalid official live connection response.");
          const link = new URL(
            start.data.websocket_info.wss_link[
              reconnects % start.data.websocket_info.wss_link.length
            ]!,
          );
          if (
            link.protocol !== "wss:" ||
            !link.hostname.endsWith(".bilibili.com") ||
            link.port ||
            link.username ||
            link.password
          )
            throw new KitError(
              "FORBIDDEN",
              "Official live server is outside the allowed Bilibili domain.",
            );
          if (options.signal.aborted) break;
          await this.connect(
            session,
            start.data.conn_id,
            link.href,
            start.data.websocket_info.auth_body,
            options,
            () => {
              eventsReceived++;
            },
          );
          break;
        } catch (error) {
          if (options.signal.aborted) break;
          if (
            !(error instanceof KitError) ||
            !["NETWORK", "UNAVAILABLE"].includes(error.code) ||
            reconnects >= maxReconnects
          )
            throw error;
          reconnects++;
          try {
            await delay(Math.min(10000, 1000 * 2 ** (reconnects - 1)), undefined, {
              signal: options.signal,
            });
          } catch {
            break;
          }
        }
      }
      return { stopped: true, eventsReceived, reconnects };
    } finally {
      this.#running = false;
    }
  }
  private async connect(
    session: OpenSession,
    connId: string,
    url: string,
    authBody: string,
    options: LiveRunOptions,
    received: () => void,
  ) {
    const heartbeat = async () => {
      const current = await this.open.session("LIVE_ROOM_DATA");
      if (
        current.authorization.uid !== session.authorization.uid ||
        current.authorization.clientId !== session.authorization.clientId
      )
        throw new KitError("FORBIDDEN", "Official live account changed; restart explicitly.");
      await this.open.request(
        current,
        "/arcopen/fn/live/room/ws-heartbeat",
        "POST",
        { conn_id: connId },
        { client_id: current.authorization.clientId },
      );
    };
    await heartbeat();
    if (options.signal.aborted) return;
    let socket: LiveSocket;
    try {
      socket = (options.socketFactory ?? ((link) => new WebSocket(link)))(url);
    } catch {
      throw new KitError("NETWORK", "Could not create the official live connection.");
    }
    socket.binaryType = "arraybuffer";
    return new Promise<void>((resolve, reject) => {
      let complete = false,
        authenticated = false,
        heartBusy = false,
        lastPong = Date.now();
      let processing = Promise.resolve();
      let timer: ReturnType<typeof setInterval> | undefined;
      const authTimeout = setTimeout(
        () => finish(new KitError("NETWORK", "Official live authentication timed out.")),
        10000,
      );
      const finish = (error?: unknown) => {
        if (complete) return;
        complete = true;
        clearTimeout(authTimeout);
        if (timer) clearInterval(timer);
        options.signal.removeEventListener("abort", abort);
        socket.removeEventListener("open", opened);
        socket.removeEventListener("message", message);
        socket.removeEventListener("error", failed);
        socket.removeEventListener("close", closed);
        try {
          socket.close();
        } catch {
          /* A socket may already be closed. */
        }
        // Finish any queue write already accepted before reporting a clean shutdown.
        if (error) reject(error);
        else void processing.then(resolve, reject);
      };
      const abort = () => finish();
      const opened = () => {
        try {
          socket.send(encodeLivePacket(7, authBody));
        } catch {
          finish(new KitError("NETWORK", "Could not authenticate the live socket."));
        }
      };
      const failed = () => finish(new KitError("NETWORK", "Official live connection failed."));
      const closed = () => finish(new KitError("NETWORK", "Official live connection closed."));
      const tick = async () => {
        if (complete || heartBusy) return;
        heartBusy = true;
        try {
          if (Date.now() - lastPong > 45000)
            throw new KitError("NETWORK", "Official live heartbeat reply timed out.");
          socket.send(encodeLivePacket(2));
          await heartbeat();
        } catch (error) {
          finish(error);
        } finally {
          heartBusy = false;
        }
      };
      const message = (event: MessageEvent) => {
        if (complete) return;
        processing = processing.then(async () => {
          const data: unknown = event.data;
          if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data))
            throw new KitError("UPSTREAM", "Expected binary official live data.");
          const bytes =
            data instanceof ArrayBuffer
              ? new Uint8Array(data)
              : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          if (bytes.length > MAX_PACKET)
            throw new KitError("UPSTREAM", "Official live frame is too large.");
          for (const packet of decodeLivePackets(bytes)) {
            if (packet.operation === 8) {
              const reply = object(parseJson(packet.body.toString("utf8")));
              if (reply.code !== 0)
                throw new KitError("FORBIDDEN", "Official live authentication was rejected.");
              if (!authenticated) {
                authenticated = true;
                clearTimeout(authTimeout);
                timer = setInterval(() => {
                  void tick();
                }, 20000);
              }
            } else if (packet.operation === 3) lastPong = Date.now();
            else if (packet.operation === 5) {
              if (!authenticated)
                throw new KitError(
                  "FORBIDDEN",
                  "Official live message arrived before authentication.",
                );
              const value = object(parseJson(packet.body.toString("utf8")));
              if (typeof value.cmd !== "string")
                throw new KitError("UPSTREAM", "Official live message is missing its command.");
              const result = await this.events.receiveLive(session.authorization, value);
              if (!result.duplicate) received();
            }
          }
        });
        void processing.catch((error) =>
          finish(
            error instanceof KitError
              ? error
              : new KitError("UPSTREAM", "Invalid official live message."),
          ),
        );
      };
      socket.addEventListener("open", opened);
      socket.addEventListener("message", message);
      socket.addEventListener("error", failed);
      socket.addEventListener("close", closed);
      options.signal.addEventListener("abort", abort, { once: true });
      if (options.signal.aborted) finish();
    });
  }
}
