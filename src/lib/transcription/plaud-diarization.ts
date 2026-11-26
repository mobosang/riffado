import { env } from "@/lib/env";
import { fetchTranscription } from "@/lib/transcription/fetch";
import type { SpeakerSegment } from "@/lib/voiceprints/format";

export const DIARIZATION_FAILED_MESSAGE =
    "Speaker recognition failed. Your existing transcript is unchanged. Check the local recognition service and retry.";

export class DiarizationError extends Error {
    constructor(public readonly status?: number) {
        super(DIARIZATION_FAILED_MESSAGE);
        this.name = "DiarizationError";
    }
}

export function isLocalDiarizationEnabled(enabled: boolean): boolean {
    return Boolean(
        enabled && !env.IS_HOSTED && env.RIFFADO_PLAUD_DIARIZATION_URL,
    );
}

export async function transcribeWithSpeakerLabels(
    audio: Buffer,
    durationMs: number,
    identify?: (
        segments: SpeakerSegment[],
    ) => Promise<ReadonlyMap<string, string>>,
): Promise<string> {
    const segments = await getDiarizedSegments(audio, durationMs);
    const names = await identify?.(segments);
    return segments
        .map(({ start, speaker, text }) => {
            const seconds = Math.floor(start);
            const timestamp = [
                Math.floor(seconds / 3600),
                Math.floor(seconds / 60) % 60,
                seconds % 60,
            ]
                .map((part) => String(part).padStart(2, "0"))
                .join(":");
            const name = names?.get(speaker);
            return `[${timestamp}] ${name ? `${name}（${speaker}）` : speaker}：${text}`;
        })
        .join("\n");
}

export async function getDiarizedSegments(
    audio: Buffer,
    durationMs: number,
    signal?: AbortSignal,
): Promise<SpeakerSegment[]> {
    const url = env.RIFFADO_PLAUD_DIARIZATION_URL;
    if (
        !url ||
        env.IS_HOSTED ||
        !audio.length ||
        audio.length > 512 * 1024 ** 2
    ) {
        throw new DiarizationError(400);
    }
    const timeoutMs =
        Number.isFinite(durationMs) && durationMs > 0
            ? Math.min(3_660_000, 150_000 + Math.ceil(durationMs * 0.3))
            : 3_660_000;
    try {
        const response = await fetchTranscription(
            url,
            {
                method: "POST",
                headers: { "Content-Type": "application/octet-stream" },
                body: new Uint8Array(audio),
                redirect: "error",
                signal,
            },
            timeoutMs,
            { retry: false },
        );
        if (!response.ok) {
            await response.body?.cancel();
            throw new DiarizationError(response.status);
        }
        const result: unknown = await response.json();
        if (
            !result ||
            typeof result !== "object" ||
            !("segments" in result) ||
            !Array.isArray(result.segments) ||
            !result.segments.length
        ) {
            throw new DiarizationError(502);
        }
        return result.segments.map((segment: unknown) => {
            if (
                !segment ||
                typeof segment !== "object" ||
                !("start" in segment) ||
                typeof segment.start !== "number" ||
                !Number.isFinite(segment.start) ||
                segment.start < 0 ||
                !("end" in segment) ||
                typeof segment.end !== "number" ||
                !Number.isFinite(segment.end) ||
                segment.end < segment.start ||
                !("speaker" in segment) ||
                typeof segment.speaker !== "string" ||
                !segment.speaker.trim() ||
                !("text" in segment) ||
                typeof segment.text !== "string" ||
                !segment.text.trim()
            ) {
                throw new DiarizationError(502);
            }
            return {
                start: segment.start,
                end: segment.end,
                speaker: segment.speaker.trim(),
                text: segment.text.trim(),
            };
        });
    } catch (error) {
        if (error instanceof DiarizationError) throw error;
        throw new DiarizationError();
    }
}
