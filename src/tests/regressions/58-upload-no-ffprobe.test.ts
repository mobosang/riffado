/**
 * Regression test for issue #58:
 *   "Upload Audio fails with 'File does not contain a valid audio stream'
 *    - ffmpeg not installed in Docker image"
 *
 * Original bug: the upload route shelled out to `ffprobe` to read audio
 * duration. When the binary was missing (Docker image without ffmpeg, or
 * dev environments where ffprobe is not on the Node process PATH), the
 * helper silently swallowed the spawn error, returned 0, and the route
 * rejected every upload with a misleading "invalid audio stream" message.
 *
 * Fix: replace the ffprobe shell-out with `music-metadata`, a pure-JS
 * parser that works on the in-memory upload buffer with no system
 * dependency. This test asserts the new path correctly reads duration
 * from a real MP3 buffer with no binary on PATH involved.
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { parseBuffer } from "music-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAudioDurationMs } from "@/lib/audio/duration";
import { runFfmpeg } from "@/lib/transcription/ffmpeg";

vi.mock("music-metadata", { spy: true });
vi.mock("@/lib/transcription/ffmpeg", () => ({ runFfmpeg: vi.fn() }));

const FIXTURE = path.join(__dirname, "..", "fixtures", "sample.mp3");

describe("issue #58 — upload duration parsing without ffprobe", () => {
    beforeEach(() => vi.clearAllMocks());

    it("reads MP3 duration from a Buffer via music-metadata (no ffprobe spawn)", async () => {
        const buffer = await readFile(FIXTURE);
        const duration = await getAudioDurationMs(buffer, "audio/mpeg");

        expect(duration).toBeGreaterThan(500);
        expect(duration).toBeLessThan(2000);
        expect(runFfmpeg).not.toHaveBeenCalled();
    });

    it("returns no duration for a non-audio buffer (caller turns this into 422)", async () => {
        const garbage = Buffer.from("this is definitely not an audio file");

        const errorLog = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        try {
            await expect(
                getAudioDurationMs(garbage, "audio/mpeg"),
            ).resolves.toBe(0);
            expect(runFfmpeg).not.toHaveBeenCalled();
        } finally {
            errorLog.mockRestore();
        }
    });

    it("uses the final decoded timestamp when an Ogg Opus recording has no duration metadata", async () => {
        const buffer = Buffer.from("OggS");
        vi.mocked(parseBuffer).mockResolvedValueOnce({
            format: {
                container: "Ogg",
                codec: "Opus",
                tagTypes: [],
                trackInfo: [],
            },
            common: {
                track: { no: null, of: null },
                disk: { no: null, of: null },
                movementIndex: { no: null, of: null },
            },
            native: {},
            quality: { warnings: [] },
        });
        vi.mocked(runFfmpeg).mockResolvedValueOnce(
            Buffer.from(
                "out_time_us=1000\nprogress=continue\nout_time_us=2500000\nprogress=end\n",
            ),
        );

        await expect(getAudioDurationMs(buffer, "audio/ogg")).resolves.toBe(
            2500,
        );
        expect(runFfmpeg).toHaveBeenCalledWith(
            buffer,
            expect.arrayContaining(["pipe:0", "pipe:1", "0:a:0"]),
        );
    });
});
