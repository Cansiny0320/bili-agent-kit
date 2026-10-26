import { z } from "zod";
import { KitError } from "./errors.js";

const identifier = z.union([z.string(), z.number().int().safe()]);
export const videoSchema = z.looseObject({
  bvid: z.string(),
  aid: identifier,
  title: z.string(),
  cid: identifier.optional(),
  desc: z.string().optional(),
  duration: z.number().optional(),
  pic: z.string().optional(),
  pages: z
    .array(
      z.looseObject({
        cid: identifier,
        page: z.number(),
        part: z.string(),
        duration: z.number().optional(),
      }),
    )
    .optional(),
});
export type Video = z.infer<typeof videoSchema>;
export const searchSchema = z.looseObject({
  result: z
    .array(
      z.looseObject({
        bvid: z.string().optional(),
        aid: identifier.optional(),
        title: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .default([]),
  page: z.number().optional(),
  numResults: z.number().optional(),
  numPages: z.number().optional(),
});
export type SearchResults = z.infer<typeof searchSchema>;
export const commentSchema = z.looseObject({
  rpid: identifier,
  ctime: z.number().optional(),
  content: z.looseObject({ message: z.string() }).optional(),
  member: z.looseObject({ mid: identifier, uname: z.string() }).optional(),
});
export const commentsSchema = z.looseObject({
  replies: z.array(commentSchema).nullable().default([]),
  page: z.looseObject({ count: z.number().optional(), num: z.number().optional() }).optional(),
});
export type Comments = z.infer<typeof commentsSchema>;
export const dmHistorySchema = z.looseObject({
  messages: z.array(
    z.looseObject({
      sender_uid: identifier,
      timestamp: z.number(),
      content: z.string(),
      msg_seqno: identifier.optional(),
      msg_key: identifier.optional(),
    }),
  ),
  has_more: z.union([z.number(), z.string(), z.boolean()]).optional(),
});
export type DmHistory = z.infer<typeof dmHistorySchema>;
export const liveInfoSchema = z.looseObject({
  room_id: identifier,
  title: z.string().optional(),
  uid: identifier.optional(),
  live_status: z.number().optional(),
});
export type LiveInfo = z.infer<typeof liveInfoSchema>;
export const liveHistorySchema = z.looseObject({
  room: z
    .array(
      z.looseObject({
        text: z.string(),
        uid: identifier.optional(),
        nickname: z.string().optional(),
        timeline: z.string().optional(),
      }),
    )
    .default([]),
});
export type LiveHistory = z.infer<typeof liveHistorySchema>;
export interface Subtitles {
  tracks: { lan: string; lan_doc?: string | undefined }[];
  selected: string | null;
  body: { from: number; to: number; content: string }[];
}
export const subtitleBodySchema = z.array(
  z.object({ from: z.number(), to: z.number(), content: z.string() }),
);
export function upstream<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new KitError("UPSTREAM", "Unexpected upstream response shape.");
  return parsed.data;
}

export function upstreamText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new KitError("UPSTREAM", "Unexpected upstream text field.");
  return value;
}
