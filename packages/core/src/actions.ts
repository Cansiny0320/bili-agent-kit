import { z } from "zod";
import { libraryActions } from "./library-actions.js";

const id = z.string().regex(/^[1-9]\d{0,19}$/);
export const attachmentSchema = z.strictObject({
  file: z.string().min(1).max(4096),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
const text = z.string().trim().min(1).max(2000);
const images = z.array(attachmentSchema).max(9).default([]);
export const extendedActions = [
  ...libraryActions,
  z.strictObject({ kind: z.literal("watch_later.add"), aid: id }),
  z.strictObject({ kind: z.literal("watch_later.remove"), aid: id }),
  z.strictObject({ kind: z.literal("video.like"), aid: id, enabled: z.boolean().default(true) }),
  z.strictObject({
    kind: z.literal("video.coin"),
    aid: id,
    count: z.union([z.literal(1), z.literal(2)]).default(1),
    like: z.boolean().default(false),
  }),
  z.strictObject({ kind: z.literal("video.triple"), aid: id }),
  z.strictObject({ kind: z.literal("favorite.add"), aid: id, folderId: id }),
  z.strictObject({ kind: z.literal("favorite.remove"), aid: id, folderId: id }),
  z.strictObject({ kind: z.literal("user.follow"), uid: id }),
  z.strictObject({ kind: z.literal("user.unfollow"), uid: id }),
  z.strictObject({
    kind: z.literal("comment.like"),
    oid: id,
    rpid: id,
    enabled: z.boolean().default(true),
  }),
  z.strictObject({
    kind: z.literal("video.danmaku"),
    aid: id,
    cid: id,
    progressMs: z.number().int().min(0).max(86400000),
    text: z.string().min(1).max(100),
    color: z.number().int().min(0).max(0xffffff).default(0xffffff),
    mode: z.union([z.literal(1), z.literal(4), z.literal(5)]).default(1),
    fontSize: z.union([z.literal(18), z.literal(25)]).default(25),
  }),
  z.strictObject({ kind: z.literal("dynamic.create"), uid: id, text, images }),
  z.strictObject({
    kind: z.literal("dynamic.edit"),
    dynamicId: id,
    text,
    images: z.array(attachmentSchema).max(9).optional(),
  }),
  z.strictObject({ kind: z.literal("dynamic.delete"), dynamicId: id }),
] as const;
export const extendedActionSchema = z.discriminatedUnion("kind", extendedActions);
export type ExtendedAction = z.output<typeof extendedActionSchema>;
export const legacyActionKinds = ["comment.add", "comment.delete", "dm.send", "live.send"];
