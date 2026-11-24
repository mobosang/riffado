import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";
import {
    DiarizationError,
    isLocalDiarizationEnabled,
    transcribeWithSpeakerLabels,
} from "@/lib/transcription/plaud-diarization";

vi.mock("@/lib/env", () => ({
    env: {
        IS_HOSTED: false,
        RIFFADO_PLAUD_DIARIZATION_URL: "http://local-asr/transcribe",
    },
}));
const audio = Buffer.from("audio");
describe("local speaker recognition", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
        env.IS_HOSTED = false;
        env.RIFFADO_PLAUD_DIARIZATION_URL = "http://local-asr/transcribe";
    });
    afterEach(() => vi.unstubAllGlobals());
    it("requires the switch, a configured service and self-host mode", () => {
        expect(isLocalDiarizationEnabled(true)).toBe(true);
        expect(isLocalDiarizationEnabled(false)).toBe(false);
        env.IS_HOSTED = true;
        expect(isLocalDiarizationEnabled(true)).toBe(false);
        env.IS_HOSTED = false;
        env.RIFFADO_PLAUD_DIARIZATION_URL = undefined;
        expect(isLocalDiarizationEnabled(true)).toBe(false);
    });
    it("renders timestamps and labels from segments even when top-level text is flat", async () => {
        vi.mocked(fetch).mockResolvedValue(
            Response.json({
                text: "flat text",
                segments: [
                    { start: 9.9, end: 12, speaker: "说话人 1", text: "你好" },
                    {
                        start: 3661,
                        end: 3662,
                        speaker: "重叠发言",
                        text: "再见",
                    },
                ],
            }),
        );
        expect(await transcribeWithSpeakerLabels(audio, 4000000)).toBe(
            "[00:00:09] 说话人 1：你好\n[01:01:01] 重叠发言：再见",
        );
        expect(fetch).toHaveBeenCalledWith(
            "http://local-asr/transcribe",
            expect.objectContaining({
                redirect: "error",
                timeout: false,
                body: new Uint8Array(audio),
            }),
        );
    });
    it("fails explicitly on busy service, transport, timeout and invalid segments", async () => {
        for (const response of [
            new Response(null, { status: 503 }),
            Response.json(null),
            Response.json({ segments: [] }),
            Response.json({
                segments: [{ start: 0, end: 1, text: "missing speaker" }],
            }),
            Response.json({
                segments: [{ start: -1, end: 1, text: "bad", speaker: "1" }],
            }),
            Response.json({
                segments: [{ start: 2, end: 1, text: "bad", speaker: "1" }],
            }),
        ]) {
            vi.mocked(fetch).mockResolvedValueOnce(response);
            await expect(
                transcribeWithSpeakerLabels(audio, 1000),
            ).rejects.toBeInstanceOf(DiarizationError);
        }
        for (const error of [
            new Error("private URL"),
            new DOMException("timeout", "TimeoutError"),
        ]) {
            vi.mocked(fetch).mockRejectedValueOnce(error);
            await expect(
                transcribeWithSpeakerLabels(audio, 1000),
            ).rejects.toThrow("Speaker recognition failed");
        }
        expect(fetch).toHaveBeenCalledTimes(8);
    });
    it("refuses hosted calls and empty audio before sending bytes", async () => {
        await expect(
            transcribeWithSpeakerLabels(Buffer.alloc(0), 1000),
        ).rejects.toThrow();
        env.IS_HOSTED = true;
        await expect(
            transcribeWithSpeakerLabels(audio, 1000),
        ).rejects.toThrow();
        expect(fetch).not.toHaveBeenCalled();
    });
});
