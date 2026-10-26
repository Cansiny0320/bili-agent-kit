import { z } from "zod";
import { attachmentSchema } from "./actions.js";
const uid = z.string().regex(/^[1-9]\d{0,19}$/);
const resourceId = z.string().regex(/^BV[0-9A-Za-z]{10}$/);
const flag = z.union([z.literal(0), z.literal(1)]);
export const videoMetadata = z
  .strictObject({
    title: z.string().trim().min(1).max(79),
    tid: z.number().int().positive(),
    tag: z.string().trim().min(1).max(199),
    desc: z.string().max(249).default(""),
    copyright: z.union([z.literal(1), z.literal(2)]).default(1),
    source: z.string().max(2000).default(""),
    no_reprint: flag.default(0),
  })
  .refine((v) => v.copyright === 1 || !!v.source, "Reposts require a source.");
export const videoEditMetadata = z.strictObject({
  title: z.string().trim().min(1).max(79),
  tid: z.number().int().positive(),
  cover: z.string().max(4096),
  desc: z.string().max(249),
  no_reprint: flag,
});
export const articleMetadata = z
  .strictObject({
    title: z.string().trim().min(1).max(40),
    category: z.number().int().positive(),
    template_id: z.union([z.literal(3), z.literal(4), z.literal(5)]),
    summary: z.string().min(200).max(40000),
    content: z.string().min(1).max(400000),
    banner_url: z.string().max(4096),
    original: flag,
    image_urls: z.string().max(20000),
    tags: z.string().max(2000),
    list_id: z.number().int().nonnegative(),
    up_closed_reply: flag,
    top_video_bvid: z.union([resourceId, z.literal("")]),
  })
  .refine((v) => !(v.banner_url && v.top_video_bvid), "Choose a banner or a top video.");
export const openActions = [
  z.strictObject({
    kind: z.literal("open.video.publish"),
    uid,
    video: attachmentSchema,
    cover: attachmentSchema.optional(),
    metadata: videoMetadata,
  }),
  z.strictObject({
    kind: z.literal("open.video.edit"),
    uid,
    resourceId,
    metadata: videoEditMetadata,
  }),
  z.strictObject({ kind: z.literal("open.video.delete"), uid, resourceId }),
  z.strictObject({ kind: z.literal("open.article.publish"), uid, metadata: articleMetadata }),
  z.strictObject({
    kind: z.literal("open.article.edit"),
    uid,
    articleId: uid,
    metadata: articleMetadata,
  }),
  z.strictObject({ kind: z.literal("open.article.delete"), uid, articleId: uid }),
  z.strictObject({ kind: z.literal("open.article.image"), uid, image: attachmentSchema }),
] as const;
export const openActionSchema = z.discriminatedUnion("kind", openActions);
export type OpenAction = z.output<typeof openActionSchema>;
