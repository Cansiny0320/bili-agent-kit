import { expect, it } from "vite-plus/test";
import { normalizeWhisper } from "../packages/core/src/asr.js";
import { setup } from "./helpers.js";

it("keeps ASR timestamps on the original media timeline", () => {
  expect(
    normalizeWhisper(
      { transcription: [{ offsets: { from: 500, to: 1700 }, text: " hello " }] },
      30,
      1.5,
    ),
  ).toEqual([{ from: 30.5, to: 31.5, content: "hello" }]);
  expect(() =>
    normalizeWhisper({ transcription: [{ offsets: { from: 1200, to: 500 }, text: "bad" }] }, 0, 3),
  ).toThrow();
});
it("requires host ASR configuration before downloading audio", async () => {
  const { kit, calls } = await setup();
  await expect(
    kit.media.call("asr_transcribe", { reference: "BV1EJ411i7Q9" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(calls).toHaveLength(0);
});
