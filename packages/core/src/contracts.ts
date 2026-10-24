import { z } from "zod";
import { KitError } from "./errors.js";

export const id = z.string().regex(/^[1-9]\d{0,19}$/);
export const bvid = z.string().regex(/^BV[0-9A-Za-z]{10}$/);
export const actionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("comment.add"),
    oid: id,
    type: z.literal(1).default(1),
    text: z.string().trim().min(1).max(1000),
    root: id.optional(),
    parent: id.optional(),
  }),
  z.strictObject({
    kind: z.literal("comment.delete"),
    oid: id,
    type: z.literal(1).default(1),
    rpid: id,
  }),
  z.strictObject({ kind: z.literal("dm.send"), uid: id, text: z.string().trim().min(1).max(1000) }),
  z.strictObject({
    kind: z.literal("live.send"),
    roomId: id,
    text: z.string().trim().min(1).max(30),
  }),
]);
export type WriteAction = z.infer<typeof actionSchema>;
export type WriteActionInput = z.input<typeof actionSchema>;
export const policySchema = z.strictObject({
  writesEnabled: z.boolean().default(false),
  allowedTargets: z
    .array(z.string().regex(/^(comment|dm|live):[1-9]\d{0,19}$/))
    .max(1000)
    .default([]),
  trustedDmTargets: z.array(id).max(1000).default([]),
});
export type Policy = z.infer<typeof policySchema>;
export const credentialSchema = z.strictObject({
  sessdata: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[^;\r\n]+$/),
  bili_jct: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[^;\r\n]+$/),
  buvid3: z
    .string()
    .max(256)
    .regex(/^[^;\r\n]*$/)
    .optional(),
});
export type Credentials = z.infer<typeof credentialSchema>;
export type CredentialProvider = () => Promise<Credentials | undefined>;
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}
export const systemClock: Clock = {
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new KitError("INVALID_INPUT", "Invalid input; check the operation schema.");
  return result.data;
}
export function targetOf(action: WriteAction): string {
  if (action.kind === "dm.send") return `dm:${action.uid}`;
  if (action.kind === "live.send") return `live:${action.roomId}`;
  return `comment:${action.oid}`;
}
export const messageSchema = z.object({
  ts: z.number().finite().nonnegative(),
  sender: z.string(),
  text: z.string(),
  key: z.string(),
  seq: z.string().nullable(),
});
export type Message = z.infer<typeof messageSchema>;
export const draftSchema = z.object({
  id: z.string(),
  key: z.string(),
  account: z.string(),
  digest: z.string(),
  action: actionSchema,
  createdAt: z.number(),
  expiresAt: z.number(),
  status: z.enum(["draft", "approved", "sending", "sent", "unknown", "rejected"]),
  approval: z.object({ digest: z.string(), by: z.string(), at: z.number() }).optional(),
  result: z.unknown().optional(),
});
export type Draft = z.infer<typeof draftSchema>;
const counterSchema = z.object({
  hourAt: z.number(),
  dayAt: z.number(),
  readHour: z.number(),
  readDay: z.number(),
  writeHour: z.number(),
  writeDay: z.number(),
  lastWrite: z.number(),
});
export const cursorSchema = z.object({
  revision: z.number().int(),
  lastSeen: z.number(),
  lastKeys: z.array(z.string()),
  pending: z.array(z.object({ receipt: z.string(), message: messageSchema })),
});
export type Cursor = z.infer<typeof cursorSchema>;
export const stateSchema = z.object({
  version: z.literal(1),
  identities: z.record(z.string(), id).default({}),
  sequence: z.number().int().nonnegative(),
  drafts: z.record(z.string(), draftSchema),
  cursors: z.record(z.string(), cursorSchema),
  deviceId: z.string(),
  traffic: z.object({
    lastDispatch: z.number(),
    until: z.number(),
    streak: z.number(),
    manual: z.record(z.string(), z.boolean()),
    active: z.object({ token: z.string(), until: z.number() }).optional(),
    accounts: z.record(z.string(), counterSchema),
  }),
});
export type State = z.infer<typeof stateSchema>;
