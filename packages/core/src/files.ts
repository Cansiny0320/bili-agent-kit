import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { KitError } from "./errors.js";

export async function localFile(
  root: string | undefined,
  file: string,
  maxBytes: number,
  expectedHash?: string,
): Promise<{ bytes: Buffer; sha256: string; path: string }> {
  if (!root) throw new KitError("FORBIDDEN", "A trusted local media root must be configured.");
  const base = await realpath(root),
    path = await realpath(file),
    rel = relative(base, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel))
    throw new KitError("FORBIDDEN", "File is outside the configured media root.");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes)
      throw new KitError("INVALID_INPUT", "Invalid file or configured size limit exceeded.");
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const n = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!n.bytesRead) throw new KitError("CONFLICT", "File changed while reading.");
      offset += n.bytesRead;
    }
    const final = await handle.stat();
    if (final.size !== stat.size || final.mtimeMs !== stat.mtimeMs)
      throw new KitError("CONFLICT", "File changed while reading.");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (expectedHash && sha256 !== expectedHash)
      throw new KitError("CONFLICT", "File content changed after approval.");
    return { bytes, sha256, path };
  } finally {
    await handle.close();
  }
}
export function imageType(bytes: Uint8Array): "image/png" | "image/jpeg" {
  if (Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  throw new KitError("INVALID_INPUT", "Only PNG and JPEG images are supported.");
}
