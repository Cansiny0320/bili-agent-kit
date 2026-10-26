import { KitError } from "./errors.js";

export interface Danmaku {
  id: string;
  progressMs: number;
  mode: number;
  fontSize: number;
  color: number;
  text: string;
  sentAt: number;
}
// Decode only documented DanmakuElem fields; unknown protobuf fields remain skippable.
export function decodeDanmaku(bytes: Uint8Array): Danmaku[] {
  let offset = 0;
  const integer = () => {
    let n = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      const byte = bytes[offset++];
      if (byte === undefined) throw new KitError("UPSTREAM", "Truncated danmaku protobuf.");
      n |= BigInt(byte & 127) << shift;
      if (!(byte & 128)) return n;
    }
    throw new KitError("UPSTREAM", "Invalid protobuf integer.");
  };
  const field = (): [number, bigint | Uint8Array] => {
    const tag = Number(integer()),
      kind = tag & 7;
    if (!tag) throw new KitError("UPSTREAM", "Invalid protobuf tag.");
    if (kind === 0) return [tag >>> 3, integer()];
    const size = kind === 2 ? Number(integer()) : kind === 1 ? 8 : kind === 5 ? 4 : -1;
    if (size < 0 || !Number.isSafeInteger(size) || offset + size > bytes.length)
      throw new KitError("UPSTREAM", "Invalid protobuf length.");
    const value = bytes.subarray(offset, offset + size);
    offset += size;
    return [tag >>> 3, value];
  };
  const rows: Danmaku[] = [];
  while (offset < bytes.length) {
    const [tag, value] = field();
    if (tag !== 1 || !(value instanceof Uint8Array)) continue;
    const fields = decodeElement(value);
    rows.push({
      id: String(fields[12] ?? fields[1] ?? ""),
      progressMs: Number(fields[2] ?? 0),
      mode: Number(fields[3] ?? 1),
      fontSize: Number(fields[4] ?? 25),
      color: Number(fields[5] ?? 0xffffff),
      text: String(fields[7] ?? ""),
      sentAt: Number(fields[8] ?? 0),
    });
  }
  return rows;
  function decodeElement(value: Uint8Array): Record<number, string | bigint> {
    const previous = bytes,
      position = offset;
    bytes = value;
    offset = 0;
    const result: Record<number, string | bigint> = {};
    while (offset < bytes.length) {
      const [key, item] = field();
      result[key] = typeof item === "bigint" ? item : new TextDecoder().decode(item);
    }
    bytes = previous;
    offset = position;
    return result;
  }
}
