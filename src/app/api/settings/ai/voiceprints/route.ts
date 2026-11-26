import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { isLocalDiarizationEnabled } from "@/lib/transcription/plaud-diarization";
import {
    MAX_LIBRARY_BYTES,
    voiceprintLibrary,
    voiceprintProvider,
} from "@/lib/voiceprints/format";
import {
    formatVoiceprintLibrary,
    getVoiceprintLibrary,
    mergeVoiceProfiles,
    requireSelfHostedVoiceprints,
    setVoiceprintProvider,
    updateVoiceProfiles,
} from "@/lib/voiceprints/library";
import { readVoiceprintJson } from "@/lib/voiceprints/read-json";

export const GET = apiHandler(async (request) => {
    const { user } = await requireApiSession(request);
    requireSelfHostedVoiceprints();
    const { provider, profiles } = await getVoiceprintLibrary(user.id);
    const headers = { "Cache-Control": "private, no-store" };
    if (new URL(request.url).searchParams.get("export") === "1") {
        return NextResponse.json(formatVoiceprintLibrary(profiles), {
            headers: {
                ...headers,
                "Content-Disposition":
                    'attachment; filename="voiceprints.json"',
            },
        });
    }
    return NextResponse.json(
        {
            provider,
            diarizationAvailable: isLocalDiarizationEnabled(true),
            profiles: profiles.map(({ id, name, samples }) => ({
                id,
                name,
                sampleCount: samples.length,
            })),
        },
        { headers },
    );
});

export const PUT = apiHandler(async (request) => {
    const { user } = await requireApiSession(request);
    requireSelfHostedVoiceprints();
    const value = z
        .object({ provider: voiceprintProvider.nullable() })
        .safeParse(await readVoiceprintJson(request, 4096));
    if (!value.success) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "Enter a valid HTTP(S) endpoint, service name and model ID.",
            400,
        );
    }
    await setVoiceprintProvider(user.id, value.data.provider);
    return NextResponse.json({ success: true });
});

export const POST = apiHandler(async (request) => {
    const { user } = await requireApiSession(request);
    requireSelfHostedVoiceprints();
    const data = voiceprintLibrary.safeParse(
        await readVoiceprintJson(request, MAX_LIBRARY_BYTES),
    );
    if (!data.success) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "Invalid or oversized voiceprint library file.",
            400,
        );
    }
    await updateVoiceProfiles(user.id, (profiles) =>
        mergeVoiceProfiles(profiles, data.data.profiles),
    );
    return NextResponse.json({ success: true });
});

export const DELETE = apiHandler(async (request) => {
    const { user } = await requireApiSession(request);
    requireSelfHostedVoiceprints();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "Choose a voiceprint to delete.",
            400,
        );
    }
    await updateVoiceProfiles(user.id, (profiles) =>
        profiles.filter((profile) => profile.id !== id),
    );
    return NextResponse.json({ success: true });
});
