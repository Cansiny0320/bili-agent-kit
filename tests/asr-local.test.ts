import { mkdtemp, copyFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { transcribe } from "../packages/core/src/asr.js";

const {
  BILI_TEST_FFMPEG: ffmpeg,
  BILI_TEST_WHISPER: executable,
  BILI_TEST_ASR_MODEL: model,
  BILI_TEST_ASR_AUDIO: audio,
} = process.env;
it.skipIf(!ffmpeg || !executable || !model || !audio)(
  "transcribes Chinese audio locally and removes intermediate files",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "bili-asr-real-")),
      file = join(root, "speech.wav");
    await copyFile(audio!, file);
    const result = await transcribe(
      { mediaRoot: root, outputRoot: root, ffmpegPath: ffmpeg! },
      { executable: executable!, model: model! },
      { file, language: "zh", durationSeconds: 10, format: "srt" },
    );
    expect(result.text).toMatch(/本地/);
    expect(result.body.length).toBeGreaterThan(0);
    expect(result.body.every((row) => row.from >= 0 && row.to <= 10 && row.to > row.from)).toBe(
      true,
    );
    expect(await readdir(root)).toEqual(["speech.wav"]);
  },
  120000,
);
