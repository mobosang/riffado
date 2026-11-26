import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { AppError, ErrorCode } from "@/lib/errors";
import {
    MAX_SAMPLE_SECONDS,
    MIN_SAMPLE_SECONDS,
    type SpeakerSegment,
    type VoiceprintCandidate,
    type VoiceprintProvider,
    type VoiceSample,
    voiceEmbedding,
} from "@/lib/voiceprints/format";
import { selectSpeakerClips } from "@/lib/voiceprints/match";
import { readVoiceprintJson } from "@/lib/voiceprints/read-json";

const SAMPLE_RATE = 16_000;
const PCM_BYTES_PER_SECOND = SAMPLE_RATE * 2;
const CAPTURE_LIMIT = MAX_SAMPLE_SECONDS * PCM_BYTES_PER_SECOND + 4096;
const AUDIO_FORMATS =
    "aac,flac,mp3,mov,mp4,m4a,3gp,3g2,mj2,ogg,wav,matroska,webm";
const exec = promisify(execFile);

function asWav(pcm: Buffer) {
    const header = Buffer.alloc(44);
    header.write("RIFF");
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(PCM_BYTES_PER_SECOND, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

async function extractPcm(
    path: string,
    clip: SpeakerSegment,
    signal?: AbortSignal,
) {
    try {
        const { stdout } = await exec(
            "ffmpeg",
            [
                "-hide_banner",
                "-nostdin",
                "-loglevel",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-format_whitelist",
                AUDIO_FORMATS,
                "-ss",
                clip.start.toFixed(3),
                "-i",
                path,
                "-t",
                (clip.end - clip.start).toFixed(3),
                "-map",
                "0:a:0",
                "-ac",
                "1",
                "-ar",
                String(SAMPLE_RATE),
                "-f",
                "s16le",
                "pipe:1",
            ],
            {
                encoding: "buffer",
                maxBuffer: CAPTURE_LIMIT,
                timeout: 30_000,
                signal,
            },
        );
        return stdout;
    } catch {
        throw new AppError(
            ErrorCode.INVALID_FILE_FORMAT,
            "Could not extract a voice sample from this recording.",
            422,
        );
    }
}

async function embed(
    pcm: Buffer,
    provider: VoiceprintProvider,
    caller?: AbortSignal,
) {
    const deadline = AbortSignal.timeout(20_000);
    const signal = caller ? AbortSignal.any([caller, deadline]) : deadline;
    const result = await fetch(provider.endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/octet-stream",
            "X-Speaker-Model": provider.model,
        },
        body: new Uint8Array(pcm),
        cache: "no-store",
        redirect: "error",
        signal,
    }).catch(() => null);
    if (!result?.ok) {
        void result?.body?.cancel().catch(() => {});
        throw new AppError(
            ErrorCode.UPSTREAM_BAD_RESPONSE,
            "Could not reach the configured voiceprint model. Check its endpoint and model ID.",
            502,
        );
    }
    const response = voiceEmbedding.safeParse(
        await readVoiceprintJson(result, 64 * 1024),
    );
    if (!response.success || response.data.model.id !== provider.model) {
        throw new AppError(
            ErrorCode.UPSTREAM_BAD_RESPONSE,
            "The voiceprint service returned an incompatible model or vector.",
            502,
        );
    }
    return response.data;
}

export async function extractSpeakerSamples({
    provider,
    audio,
    segments,
    recordingId,
    preview = false,
    signal,
}: {
    provider: VoiceprintProvider;
    audio: Buffer;
    segments: SpeakerSegment[];
    recordingId: string;
    preview?: boolean;
    signal?: AbortSignal;
}) {
    const candidates = [...selectSpeakerClips(segments)]
        .filter(([, clips]) => preview || clips.length === 2)
        .slice(0, 8);
    const speakers = new Map<
        string,
        {
            samples: VoiceSample[];
            clips: VoiceprintCandidate["clips"];
        }
    >();
    if (!candidates.length) return speakers;

    const dir = await mkdtemp(join(tmpdir(), "riffado-voiceprints-"));
    try {
        const path = join(dir, "audio");
        await writeFile(path, audio, { mode: 0o600 });
        for (const [speaker, clips] of candidates) {
            const samples: VoiceSample[] = [];
            const previews: VoiceprintCandidate["clips"] = [];
            for (const clip of clips) {
                const pcm = await extractPcm(path, clip, signal);
                if (pcm.length < MIN_SAMPLE_SECONDS * PCM_BYTES_PER_SECOND)
                    continue;
                const embedding = await embed(pcm, provider, signal);
                samples.push({
                    ...embedding,
                    source: { recordingId, start: clip.start, end: clip.end },
                });
                if (preview) {
                    previews.push({
                        start: clip.start,
                        text: clip.text,
                        preview: asWav(pcm).toString("base64"),
                    });
                }
            }
            if (samples.length)
                speakers.set(speaker, { samples, clips: previews });
        }
        return speakers;
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}
