import QRCode from "qrcode";
import { resolve } from "node:path";
import {
  loadAuth,
  defaultConfigPath,
  writePrivateFile,
  KitError,
  FileStore,
  type FileAuth,
} from "@bili-agent-kit/core";

export interface AuthCliOptions {
  load?: (path?: string) => Promise<FileAuth>;
  stderr?: (text: string) => void;
  signal?: AbortSignal;
}
export async function runAuthCli(
  config: string | undefined,
  name: string,
  input: unknown,
  options: AuthCliOptions = {},
): Promise<unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new KitError("INVALID_INPUT", "Auth input must be an object.");
  const args = input as Record<string, unknown>;
  if (
    !["auth.login", "auth.status", "auth.logout", "auth.refresh-check", "auth.refresh"].includes(
      name,
    ) ||
    Object.keys(args).some((k) => name !== "auth.login" || k !== "png") ||
    (args.png !== undefined && (typeof args.png !== "string" || !args.png.length))
  )
    throw new KitError(
      "INVALID_INPUT",
      'Use auth.login {"png":"optional-new-file.png"}, auth.status {} or auth.logout {}.',
    );
  const auth = await (options.load ?? loadAuth)(config);
  if (name === "auth.refresh-check") return auth.refreshCheck(options.signal);
  if (name === "auth.refresh") return auth.refresh(options.signal);
  if (name === "auth.status") return auth.status(options.signal);
  if (name === "auth.logout") return auth.logout();
  const current = await auth.status(options.signal);
  if (current.authenticated) return current;
  if (typeof args.png === "string") {
    const normalize = (path: string) =>
      process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
    const reserved = [
      config ?? defaultConfigPath(),
      auth.credentials.path,
      `${auth.credentials.path}.lock`,
    ];
    if (auth.store instanceof FileStore)
      reserved.push(
        resolve(auth.store.directory, "state.json"),
        resolve(auth.store.directory, "state.json.lock"),
      );
    if (reserved.some((path) => normalize(path) === normalize(args.png as string)))
      throw new KitError(
        "INVALID_INPUT",
        "Choose a PNG path separate from configuration, credentials and state.",
      );
  }
  const stderr =
    options.stderr ??
    ((text) => {
      process.stderr.write(text);
    });
  let previous = "";
  return auth.login({
    ...(options.signal ? { signal: options.signal } : {}),
    onQr: async (qr) => {
      if (typeof args.png === "string") {
        const path = resolve(args.png);
        await writePrivateFile(
          path,
          await QRCode.toBuffer(qr.url, { type: "png", margin: 4, scale: 6 }),
        );
        stderr(`二维码已保存到 ${path}\n`);
      }
      stderr(await QRCode.toString(qr.url, { type: "terminal", small: true }));
      stderr("请用哔哩哔哩 App 扫码并在手机上确认。Ctrl+C 取消。\n");
    },
    onStatus: (status) => {
      if (previous === status) return;
      previous = status;
      stderr(status === "scanned" ? "已扫码，等待手机确认。\n" : "等待扫码。\n");
    },
  });
}
