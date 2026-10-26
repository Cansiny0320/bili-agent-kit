import { spawn } from "node:child_process";
import { KitError } from "./errors.js";
import type { MediaOptions } from "./media.js";

export function ffmpeg(options: MediaOptions, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      options.ffmpegPath,
      ["-nostdin", "-v", "error", "-n", "-threads", "2", ...args],
      {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
        timeout: options.timeoutMs ?? 120000,
        killSignal: "SIGKILL",
      },
    );
    child.once("error", () => reject(new KitError("UNAVAILABLE", "ffmpeg could not run.")));
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new KitError("UNAVAILABLE", "ffmpeg failed or timed out.")),
    );
  });
}
