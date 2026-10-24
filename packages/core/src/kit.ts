import {
  policySchema,
  parse,
  systemClock,
  type Clock,
  type CredentialProvider,
  type Policy,
} from "./contracts.js";
import { BiliClient } from "./client.js";
import { Traffic } from "./traffic.js";
import type { StateStore } from "./state.js";
import { Administrator, Writes } from "./writes.js";
import { DmPoller } from "./poll.js";
import type { FrameOptions } from "./frames.js";

export interface KitOptions {
  store: StateStore;
  credentials?: CredentialProvider;
  policy?: Partial<Policy>;
  clock?: Clock;
  fetch?: typeof fetch;
  frames?: FrameOptions;
}
export type ReadApi = Pick<
  BiliClient,
  "video" | "search" | "subtitles" | "comments" | "liveInfo" | "liveHistory"
> & {
  dmHistory(input: {
    uid: string;
    beforeSeq?: string | undefined;
  }): ReturnType<BiliClient["dmHistory"]>;
};
export class BiliKit {
  readonly reads: ReadApi;
  readonly writes: Writes;
  readonly admin: Administrator;
  readonly dm: DmPoller;
  readonly frames: FrameOptions | undefined;
  constructor(options: KitOptions) {
    const client = new BiliClient(
      new Traffic(options.store, options.clock ?? systemClock, options.fetch ?? globalThis.fetch),
      options.credentials ?? (async () => undefined),
      parse(policySchema, options.policy ?? {}),
    );
    this.reads = Object.freeze({
      video: client.video.bind(client),
      search: client.search.bind(client),
      subtitles: client.subtitles.bind(client),
      comments: client.comments.bind(client),
      liveInfo: client.liveInfo.bind(client),
      liveHistory: client.liveHistory.bind(client),
      dmHistory: (input: { uid: string; beforeSeq?: string | undefined }) =>
        client.dmHistory(input),
    });
    this.writes = new Writes(client, options.store);
    this.admin = new Administrator(this.writes, client, options.store);
    this.dm = new DmPoller(client, options.store);
    this.frames = options.frames;
  }
}
