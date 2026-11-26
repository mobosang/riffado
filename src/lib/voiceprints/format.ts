import { z } from "zod";

export const CAMPPLUS_MODEL = "3dspeaker/campplus-zh-en-16k-common-advanced";
export const MIN_SAMPLE_SECONDS = 3;
export const MAX_SAMPLE_SECONDS = 6;
export const MAX_PROFILES = 40;
export const MAX_SAMPLES = 6;
export const MAX_LIBRARY_BYTES = 8 * 1024 * 1024;

const modelId = z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_./:+-]{1,128}$/);
export const voiceName = z
    .string()
    .trim()
    .min(1)
    .max(60)
    .refine((name) => !/[\r\n:：\p{Cc}\p{Zl}\p{Zp}]/u.test(name));

export const voiceprintProvider = z.object({
    endpoint: z
        .url({
            protocol: /^https?$/,
            normalize: true,
        })
        .max(512)
        .refine((value) => {
            if (!URL.canParse(value)) return false;
            const url = new URL(value);
            return !url.username && !url.password && !url.hash && !url.search;
        }),
    name: z.string().trim().min(1).max(80),
    model: modelId,
});

const embeddingModel = z.object({
    id: modelId,
    revision: z.string().trim().min(1).max(160),
    dimension: z.number().int().min(2).max(1024),
});

export const voiceEmbedding = z
    .object({
        model: embeddingModel,
        embedding: z.array(z.number().min(-1e6).max(1e6)).min(2).max(1024),
    })
    .refine(
        ({ model, embedding }) =>
            embedding.length === model.dimension &&
            Math.hypot(...embedding) >= 1e-9,
    );

export const voiceSample = voiceEmbedding.safeExtend({
    source: z
        .object({
            recordingId: z.string().min(1).max(100),
            start: z.number().min(0),
            end: z.number().min(0),
        })
        .refine(
            ({ start, end }) =>
                end - start >= MIN_SAMPLE_SECONDS - 0.001 &&
                end - start <= MAX_SAMPLE_SECONDS + 0.001,
        )
        .optional(),
});

export const voiceProfile = z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    name: voiceName,
    samples: z.array(voiceSample).min(1).max(MAX_SAMPLES),
});

export const voiceprintLibrary = z
    .object({
        format: z.literal("riffado.voiceprints"),
        version: z.literal(1),
        profiles: z.array(voiceProfile).max(MAX_PROFILES),
    })
    .refine(
        ({ profiles }) =>
            new Set(profiles.map(({ id }) => id)).size === profiles.length &&
            new Set(profiles.map(({ name }) => name)).size === profiles.length,
    );

export type VoiceprintProvider = z.infer<typeof voiceprintProvider>;
export type VoiceSample = z.infer<typeof voiceSample>;
export type VoiceProfile = z.infer<typeof voiceProfile>;

export interface VoiceprintCandidate {
    speaker: string;
    name?: string;
    clips: { start: number; text: string; preview: string }[];
    proof: string;
}

export interface RecordingVoiceprints {
    saved: { id: string; name: string; sampleCount: number }[];
    candidates: VoiceprintCandidate[];
}

export interface SpeakerSegment {
    speaker: string;
    start: number;
    end: number;
    text: string;
}
