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
import { ContentReads, readMethods, type ReadMethods } from "./reads.js";
import { OpenPlatform, type OpenOptions } from "./open-platform.js";
import { Media, type MediaOptions } from "./media.js";
import { EventPoller } from "./events.js";

export interface KitOptions {
  store: StateStore;
  credentials?: CredentialProvider;
  policy?: Partial<Policy>;
  clock?: Clock;
  fetch?: typeof fetch;
  frames?: FrameOptions;
  media?: MediaOptions;
  openPlatform?: OpenOptions;
}
export type ReadApi = Pick<
  BiliClient,
  "video" | "search" | "subtitles" | "comments" | "liveInfo" | "liveHistory"
> &
  ReadMethods & {
    dmHistory(input: {
      uid: string;
      beforeSeq?: string | undefined;
    }): ReturnType<BiliClient["dmHistory"]>;
  };
export class BiliKit {
  readonly open: OpenPlatform;
  readonly media: Media;
  readonly content: ContentReads;
  readonly events: EventPoller;
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
    this.content = new ContentReads(client);
    this.media = new Media(client, this.content, options.media ?? options.frames);
    this.events = new EventPoller(client, options.store, this.content);
    this.reads = Object.freeze({
      ...readMethods(this.content),
      video: client.video.bind(client),
      search: client.search.bind(client),
      subtitles: client.subtitles.bind(client),
      comments: client.comments.bind(client),
      liveInfo: client.liveInfo.bind(client),
      liveHistory: client.liveHistory.bind(client),
      dmHistory: (input: { uid: string; beforeSeq?: string | undefined }) =>
        client.dmHistory(input),
    });
    this.open = new OpenPlatform(
      client.traffic,
      options.openPlatform,
      (options.media ?? options.frames)?.mediaRoot,
    );
    this.writes = new Writes(
      client,
      options.store,
      (options.media ?? options.frames)?.mediaRoot,
      this.open,
    );
    this.admin = new Administrator(this.writes, client, options.store);
    this.dm = new DmPoller(client, options.store);
    this.frames = options.frames;
  }
}
