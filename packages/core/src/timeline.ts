import { z } from "zod";
import { parse } from "./contracts.js";
import { KitError } from "./errors.js";

export const timeRangeFields = {
  startSeconds: z.number().finite().min(0).max(86400).optional(),
  endSeconds: z.number().finite().positive().max(86400).optional(),
};
export interface TimeRange {
  startSeconds?: number | undefined;
  endSeconds?: number | undefined;
}
export function timeRange(input: TimeRange) {
  const a = parse(z.object(timeRangeFields), input);
  const start = a.startSeconds ?? 0,
    end = a.endSeconds ?? Infinity;
  if (end <= start) throw new KitError("INVALID_INPUT", "endSeconds must exceed startSeconds.");
  return { start, end };
}
export function clipSubtitles<T extends { from: number; to: number; content: string }>(
  lines: T[],
  input: TimeRange,
): T[] {
  const { start, end } = timeRange(input);
  return lines
    .filter((line) => line.to > start && line.from < end)
    .map((line) => ({ ...line, from: Math.max(start, line.from), to: Math.min(end, line.to) }));
}
