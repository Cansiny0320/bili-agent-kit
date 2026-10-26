import { deflateSync } from "node:zlib";
import { expect, it } from "vite-plus/test";
import { decodeLivePackets, encodeLivePacket } from "../packages/core/src/open-live.js";
import { BiliKit } from "../packages/core/src/kit.js";
import { json, setup } from "./helpers.js";

it("decodes concatenated and zlib-compressed official packets and rejects truncated frames", () => {
  const a = encodeLivePacket(
    5,
    JSON.stringify({ cmd: "LIVE_OPEN_PLATFORM_DM", data: { msg_id: "one" } }),
  );
  const b = encodeLivePacket(3);
  const compressed = encodeLivePacket(5, deflateSync(Buffer.concat([a, b])), 2);
  const packets = decodeLivePackets(compressed);
  expect(packets.map((p) => p.operation)).toEqual([5, 3]);
  expect(JSON.parse(packets[0]!.body.toString()).data.msg_id).toBe("one");
  expect(() => decodeLivePackets(a.subarray(0, -1))).toThrow();
  expect(() => decodeLivePackets(Buffer.alloc(16))).toThrow();
});

it("authenticates, persists live messages and closes on host cancellation", async () => {
  const ctx = await setup((url) =>
    url.pathname.endsWith("ws-start")
      ? json({
          conn_id: "conn",
          websocket_info: {
            auth_body: '{"key":"secret"}',
            wss_link: ["wss://broadcastlv.chat.bilibili.com/sub"],
          },
        })
      : json({}),
  );
  const kit = new BiliKit({
    ...ctx.options,
    openPlatform: {
      credentials: async () => ({
        clientId: "app",
        appSecret: "secret",
        accessToken: "token",
        uid: "111",
        scopes: ["LIVE_ROOM_DATA"],
      }),
    },
  });
  const controller = new AbortController();
  class Socket extends EventTarget {
    readyState = 1 as const;
    binaryType: BinaryType = "arraybuffer";
    closed = false;
    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      const packet = decodeLivePackets(Buffer.from(data as Uint8Array))[0]!;
      if (packet.operation === 7) {
        expect(JSON.parse(packet.body.toString())).toEqual({ key: "secret" });
        queueMicrotask(() => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: encodeLivePacket(8, '{"code":0}').buffer.slice(0),
            }),
          );
          const message = encodeLivePacket(
            5,
            '{"cmd":"LIVE_OPEN_PLATFORM_DM","data":{"msg_id":"1","msg":"hello"}}',
          );
          this.dispatchEvent(new MessageEvent("message", { data: message }));
        });
      }
    }
    close() {
      this.closed = true;
      this.dispatchEvent(new Event("close"));
    }
  }
  let socket: Socket | undefined;
  const running = kit.openLive.run({
    signal: controller.signal,
    socketFactory: () => {
      socket = new Socket();
      return socket;
    },
  });
  try {
    await expect
      .poll(async () => (await kit.openEvents.peek({ source: "live" })).event?.event, {
        timeout: 5000,
      })
      .toMatchObject({ data: { msg: "hello" } });
  } finally {
    controller.abort();
  }
  expect(await running).toMatchObject({ stopped: true, eventsReceived: 1 });
  expect(socket?.closed).toBe(true);
  expect(ctx.calls.some((c) => c.url.pathname.endsWith("ws-heartbeat"))).toBe(true);
});

it("bounds reconnect attempts and releases sockets after connection failure", async () => {
  const ctx = await setup((url) =>
    url.pathname.endsWith("ws-start")
      ? json({
          conn_id: "conn",
          websocket_info: {
            auth_body: "{}",
            wss_link: ["wss://broadcastlv.chat.bilibili.com/sub"],
          },
        })
      : json({}),
  );
  const kit = new BiliKit({
    ...ctx.options,
    openPlatform: {
      credentials: async () => ({
        clientId: "app",
        appSecret: "secret",
        accessToken: "token",
        uid: "111",
        scopes: ["LIVE_ROOM_DATA"],
      }),
    },
  });
  let opened = 0,
    closed = 0;
  class Broken extends EventTarget {
    readyState = 3 as const;
    binaryType: BinaryType = "arraybuffer";
    constructor() {
      super();
      opened++;
      queueMicrotask(() => this.dispatchEvent(new Event("error")));
    }
    send() {}
    close() {
      closed++;
    }
  }
  await expect(
    kit.openLive.run({
      signal: new AbortController().signal,
      maxReconnects: 1,
      socketFactory: () => new Broken(),
    }),
  ).rejects.toMatchObject({ code: "NETWORK" });
  expect(opened).toBe(2);
  expect(closed).toBe(2);
  const stopped = new AbortController();
  stopped.abort();
  expect(await kit.openLive.run({ signal: stopped.signal })).toMatchObject({
    stopped: true,
    reconnects: 0,
  });
});
