import { z } from "zod";

const id = z.string().regex(/^[1-9]\d{0,19}$/);
const aids = z
  .array(id)
  .min(1)
  .max(50)
  .refine((values) => new Set(values).size === values.length);
const fields = {
  title: z.string().trim().min(1).max(80),
  intro: z.string().max(500),
  cover: z.string().max(2048),
  privacy: z.union([z.literal(0), z.literal(1)]),
};
export const folderSnapshot = z.strictObject(fields);
export const libraryActions = [
  z.strictObject({ kind: z.literal("watch_later.batch_add"), aids }),
  z.strictObject({ kind: z.literal("watch_later.move"), aids, folderId: id }),
  z.strictObject({
    kind: z.literal("favorite.folder_create"),
    uid: id,
    ...fields,
    intro: fields.intro.default(""),
    cover: fields.cover.default(""),
    privacy: fields.privacy.default(1),
  }),
  z.strictObject({
    kind: z.literal("favorite.folder_edit"),
    folderId: id,
    title: fields.title.optional(),
    intro: fields.intro.optional(),
    cover: fields.cover.optional(),
    privacy: fields.privacy.optional(),
    expected: folderSnapshot.optional(),
  }),
  z.strictObject({ kind: z.literal("favorite.copy"), sourceFolderId: id, folderId: id, aids }),
  z.strictObject({ kind: z.literal("favorite.move"), sourceFolderId: id, folderId: id, aids }),
  z.strictObject({ kind: z.literal("favorite.sort"), folderId: id, aid: id, afterAid: id }),
] as const;
export const libraryActionSchema = z.discriminatedUnion("kind", libraryActions);
export type LibraryAction = z.output<typeof libraryActionSchema>;
