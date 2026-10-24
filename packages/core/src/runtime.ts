import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { credentialSchema, parse, policySchema } from "./contracts.js";
import { KitError } from "./errors.js";
import { FileStore } from "./state.js";
import { BiliKit } from "./kit.js";

export const configSchema = z.strictObject({
  version: z.literal(1),
  stateDir: z.string().min(1),
  credentialsFile: z.string().min(1).optional(),
  policy: policySchema.default({ writesEnabled: false, allowedTargets: [], trustedDmTargets: [] }),
  frames: z
    .strictObject({
      mediaRoot: z.string().min(1),
      outputRoot: z.string().min(1),
      ffmpegPath: z.string().min(1),
    })
    .optional(),
});
async function readJson(file: string): Promise<unknown> {
  try {
    if ((await stat(file)).size > 1024 * 1024) throw new Error("size");
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    throw new KitError("INVALID_INPUT", "Cannot read the configured JSON file.");
  }
}
export async function loadKit(configPath: string): Promise<BiliKit> {
  const absolute = resolve(configPath),
    base = dirname(absolute);
  const config = parse(configSchema, await readJson(absolute));
  return new BiliKit({
    store: new FileStore(resolve(base, config.stateDir)),
    policy: config.policy,
    credentials: async () =>
      config.credentialsFile
        ? parse(credentialSchema, await readJson(resolve(base, config.credentialsFile)))
        : undefined,
    ...(config.frames
      ? {
          frames: {
            mediaRoot: resolve(base, config.frames.mediaRoot),
            outputRoot: resolve(base, config.frames.outputRoot),
            ffmpegPath: config.frames.ffmpegPath,
          },
        }
      : {}),
  });
}
