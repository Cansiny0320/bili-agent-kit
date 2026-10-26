import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { parse, policySchema, systemClock } from "./contracts.js";
import { FileCredentials } from "./credentials.js";
import { FileAuth } from "./auth-runtime.js";
import { QrLogin } from "./auth.js";
import { KitError } from "./errors.js";
import { FileStore } from "./state.js";
import { openCredentialSchema } from "./open-platform.js";
import { mediaConfig } from "./media.js";
import { BiliKit } from "./kit.js";
import { OpenAuth } from "./open-auth.js";
import { Traffic } from "./traffic.js";

export const configSchema = z.strictObject({
  version: z.literal(1),
  stateDir: z.string().min(1),
  credentialsFile: z.string().min(1).optional(),
  policy: policySchema.default({
    writesEnabled: false,
    allowedActions: [],
    allowedTargets: [],
    trustedDmTargets: [],
  }),
  media: mediaConfig.optional(),
  openPlatform: z
    .strictObject({
      credentialsFile: z.string().min(1),
      maxUploadBytes: z
        .number()
        .int()
        .positive()
        .max(512 * 1024 * 1024)
        .default(128 * 1024 * 1024),
    })
    .optional(),
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
        ? new FileCredentials(resolve(base, config.credentialsFile)).read()
        : undefined,
    ...(config.openPlatform
      ? {
          openPlatform: {
            credentials: async () =>
              parse(
                openCredentialSchema,
                await readJson(resolve(base, config.openPlatform!.credentialsFile)),
              ),
            maxUploadBytes: config.openPlatform.maxUploadBytes,
          },
        }
      : {}),
    ...(config.media
      ? {
          media: {
            ...config.media,
            mediaRoot: resolve(base, config.media.mediaRoot),
            outputRoot: resolve(base, config.media.outputRoot),
            ...(config.media.asr
              ? { asr: { ...config.media.asr, model: resolve(base, config.media.asr.model) } }
              : {}),
          },
        }
      : {}),
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
export async function loadAuth(configPath: string, protocol = new QrLogin()): Promise<FileAuth> {
  const absolute = resolve(configPath),
    base = dirname(absolute);
  const config = parse(configSchema, await readJson(absolute));
  if (!config.credentialsFile)
    throw new KitError(
      "INVALID_INPUT",
      "Set credentialsFile in the configuration before using auth commands.",
    );
  const credentialPath = resolve(base, config.credentialsFile);
  const stateDir = resolve(base, config.stateDir);
  const samePath = (a: string, b: string) =>
    process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (
    [absolute, resolve(stateDir, "state.json"), resolve(stateDir, "state.json.lock")].some((p) =>
      samePath(p, credentialPath),
    )
  )
    throw new KitError(
      "INVALID_INPUT",
      "Credentials must use a separate file from config and state.",
    );
  return new FileAuth(new FileCredentials(credentialPath), new FileStore(stateDir), protocol);
}
export async function loadOpenAuth(configPath: string): Promise<OpenAuth> {
  const absolute = resolve(configPath),
    base = dirname(absolute),
    config = parse(configSchema, await readJson(absolute));
  if (!config.openPlatform)
    throw new KitError("AUTH_REQUIRED", "Configure openPlatform.credentialsFile first.");
  const file = resolve(base, config.openPlatform.credentialsFile);
  const reserved = [
    absolute,
    resolve(base, config.stateDir, "state.json"),
    resolve(base, config.stateDir, "state.json.lock"),
    ...(config.credentialsFile ? [resolve(base, config.credentialsFile)] : []),
  ];
  if (
    reserved.some((path) =>
      process.platform === "win32" ? path.toLowerCase() === file.toLowerCase() : path === file,
    )
  )
    throw new KitError(
      "INVALID_INPUT",
      "OAuth credentials must be separate from Cookie credentials, configuration and state.",
    );
  return new OpenAuth(
    file,
    new Traffic(new FileStore(resolve(base, config.stateDir)), systemClock, globalThis.fetch),
  );
}
