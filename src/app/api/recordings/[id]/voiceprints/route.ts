import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { decryptJSON, encryptJSON } from "@/lib/encryption";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import {
    DownloadSizeLimitError,
    downloadFileWithLimit,
} from "@/lib/storage/download-limited";
import { createUserStorageProvider } from "@/lib/storage/factory";
import {
    getDiarizedSegments,
    isLocalDiarizationEnabled,
} from "@/lib/transcription/plaud-diarization";
import { extractSpeakerSamples } from "@/lib/voiceprints/extract";
import {
    type RecordingVoiceprints,
    type VoiceProfile,
    type VoiceprintCandidate,
    voiceName,
    voiceSample,
} from "@/lib/voiceprints/format";
import {
    getVoiceprintLibrary,
    mergeVoiceProfiles,
    requireSelfHostedVoiceprints,
    updateVoiceProfiles,
} from "@/lib/voiceprints/library";
import { matchSpeakerNames } from "@/lib/voiceprints/match";
import { readVoiceprintJson } from "@/lib/voiceprints/read-json";

type Context = { params: Promise<{ id: string }> };
const LIMIT = 512 * 1024 ** 2;
const PRIVATE_RESPONSE = { headers: { "Cache-Control": "private, no-store" } };
const proofSchema = z.object({
    type: z.literal("riffado.voiceprint-enrollment"),
    userId: z.string(),
    recordingId: z.string(),
    expiresAt: z.number(),
    endpoint: z.string(),
    model: z.string(),
    samples: z.array(voiceSample).min(1).max(2),
});

async function activeRecording(userId: string, id: string) {
    const [recording] = await db
        .select({
            storagePath: recordings.storagePath,
            duration: recordings.duration,
        })
        .from(recordings)
        .where(
            and(
                eq(recordings.id, id),
                eq(recordings.userId, userId),
                isNull(recordings.deletedAt),
            ),
        )
        .limit(1);
    if (!recording)
        throw new AppError(
            ErrorCode.RECORDING_NOT_FOUND,
            "Recording not found",
            404,
        );
    return recording;
}

function savedForRecording(
    profiles: VoiceProfile[],
    recordingId: string,
): RecordingVoiceprints["saved"] {
    return profiles.flatMap(({ id, name, samples }) => {
        const sampleCount = samples.filter(
            ({ source }) => source?.recordingId === recordingId,
        ).length;
        return sampleCount ? [{ id, name, sampleCount }] : [];
    });
}

export const GET = apiHandler<Context>(async (request, context) => {
    const { user } = await requireApiSession(request);
    requireSelfHostedVoiceprints();
    const { id } = await (context as Context).params;
    await activeRecording(user.id, id);
    const { profiles } = await getVoiceprintLibrary(user.id);
    return NextResponse.json(
        { saved: savedForRecording(profiles, id), candidates: [] },
        PRIVATE_RESPONSE,
    );
});

export const POST = apiHandler<Context>(async (request, context) => {
    const { user } = await requireApiSession(request);
    requireSelfHostedVoiceprints();
    const { id } = await (context as Context).params;
    const recording = await activeRecording(user.id, id);
    const { provider, profiles } = await getVoiceprintLibrary(user.id);
    const saved = savedForRecording(profiles, id);
    if (
        saved.length &&
        new URL(request.url).searchParams.get("regenerate") !== "1"
    ) {
        return NextResponse.json({ saved, candidates: [] }, PRIVATE_RESPONSE);
    }
    if (!provider) {
        throw new AppError(
            ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
            "Add a voiceprint service in Settings → AI → Providers first.",
            400,
        );
    }
    if (!isLocalDiarizationEnabled(true)) {
        throw new AppError(
            ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
            "Configure a local diarization service first.",
            400,
        );
    }

    const storage = await createUserStorageProvider(user.id);
    const audio = await downloadFileWithLimit(
        storage,
        recording.storagePath,
        LIMIT,
    ).catch((error) => {
        if (error instanceof DownloadSizeLimitError) {
            throw new AppError(
                ErrorCode.FILE_TOO_LARGE,
                "This recording is too large for voiceprint generation.",
                413,
            );
        }
        throw new AppError(
            ErrorCode.STORAGE_ERROR,
            "Could not read the recording audio for voiceprint generation.",
            422,
        );
    });
    const segments = await getDiarizedSegments(
        audio,
        recording.duration,
        request.signal,
    ).catch(() => {
        throw new AppError(
            ErrorCode.DIARIZATION_FAILED,
            "Could not separate speakers for voiceprint generation. Check the local diarization service.",
            502,
        );
    });
    const extracted = await extractSpeakerSamples({
        provider,
        audio,
        segments,
        recordingId: id,
        preview: true,
        signal: request.signal,
    });
    const matches = matchSpeakerNames(
        new Map(
            [...extracted].map(([speaker, value]) => [speaker, value.samples]),
        ),
        profiles,
    );
    const candidates: VoiceprintCandidate[] = [...extracted].map(
        ([speaker, value]) => ({
            speaker,
            name: matches.get(speaker),
            clips: value.clips,
            proof: encryptJSON({
                type: "riffado.voiceprint-enrollment",
                userId: user.id,
                recordingId: id,
                expiresAt: Date.now() + 30 * 60_000,
                endpoint: provider.endpoint,
                model: provider.model,
                samples: value.samples,
            }),
        }),
    );
    return NextResponse.json({ saved, candidates }, PRIVATE_RESPONSE);
});

export const PUT = apiHandler<Context>(async (request, context) => {
    const { user } = await requireApiSession(request);
    requireSelfHostedVoiceprints();
    const { id } = await (context as Context).params;
    await activeRecording(user.id, id);
    const value = z
        .object({
            name: voiceName,
            proof: z.string().min(1).max(256_000),
        })
        .safeParse(await readVoiceprintJson(request, 272_000));
    const invalid = new AppError(
        ErrorCode.INVALID_INPUT,
        "The name or voice samples are invalid. Generate the samples again if they have expired.",
        400,
    );
    if (!value.success) throw invalid;
    let decrypted: unknown;
    try {
        decrypted = decryptJSON(value.data.proof);
    } catch {
        throw invalid;
    }
    const parsed = proofSchema.safeParse(decrypted);
    if (
        !parsed.success ||
        parsed.data.userId !== user.id ||
        parsed.data.recordingId !== id ||
        parsed.data.expiresAt < Date.now()
    )
        throw invalid;

    const proof = parsed.data;
    await updateVoiceProfiles(user.id, (profiles, provider) => {
        if (
            proof.endpoint !== provider?.endpoint ||
            proof.model !== provider.model
        ) {
            throw new AppError(
                ErrorCode.CONFLICT,
                "The voiceprint service changed. Generate the samples again.",
                409,
            );
        }
        const otherPersonHasSample = profiles.some(
            (profile) =>
                profile.name !== value.data.name &&
                profile.samples.some(
                    ({ source }) =>
                        source &&
                        proof.samples.some(
                            (sample) =>
                                sample.source?.recordingId ===
                                    source.recordingId &&
                                sample.source.start === source.start &&
                                sample.source.end === source.end,
                        ),
                ),
        );
        if (otherPersonHasSample) {
            throw new AppError(
                ErrorCode.CONFLICT,
                "This sample is already saved under another name.",
                409,
            );
        }
        return mergeVoiceProfiles(profiles, [
            { name: value.data.name, samples: proof.samples },
        ]);
    });
    return NextResponse.json({ success: true });
});
