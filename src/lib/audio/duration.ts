import { parseBuffer } from "music-metadata";
import { runFfmpeg } from "@/lib/transcription/ffmpeg";

/** Read upload duration, including Opus recordings with missing Ogg end markers. */
export async function getAudioDurationMs(
    buffer: Buffer,
    mimeType: string,
): Promise<number> {
    try {
        const { format } = await parseBuffer(
            buffer,
            { mimeType, size: buffer.byteLength },
            { duration: true },
        );
        const seconds = format.duration ?? 0;
        if (Number.isFinite(seconds) && seconds > 0) {
            return Math.round(seconds * 1000);
        }
        if (format.container !== "Ogg" || format.codec !== "Opus") return 0;

        const progress = await runFfmpeg(buffer, [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-nostats",
            "-progress",
            "pipe:1",
            "-i",
            "pipe:0",
            "-map",
            "0:a:0",
            "-f",
            "null",
            "-",
        ]);
        const lastTime = [
            ...progress.toString().matchAll(/^out_time_us=(\d+)\r?$/gm),
        ].at(-1)?.[1];
        return Math.round(Number(lastTime ?? 0) / 1000);
    } catch (error) {
        console.error("Audio duration probe failed:", error);
        return 0;
    }
}
