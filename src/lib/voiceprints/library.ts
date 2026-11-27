import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { speakerLibraries } from "@/db/schema";
import { decryptText, encryptText } from "@/lib/encryption/fields";
import { env } from "@/lib/env";
import { AppError, ErrorCode } from "@/lib/errors";
import {
    MAX_PROFILES,
    MAX_SAMPLES,
    type VoiceProfile,
    type VoiceprintProvider,
} from "@/lib/voiceprints/format";

export function requireSelfHostedVoiceprints() {
    if (env.IS_HOSTED) {
        throw new AppError(
            ErrorCode.FORBIDDEN,
            "Voiceprints are available on self-hosted Riffado.",
            403,
        );
    }
}

export async function getVoiceprintLibrary(userId: string) {
    if (env.IS_HOSTED) return { provider: null, profiles: [] };

    const [row] = await db
        .select()
        .from(speakerLibraries)
        .where(eq(speakerLibraries.userId, userId))
        .limit(1);
    return {
        provider: row?.provider
            ? (JSON.parse(decryptText(row.provider)) as VoiceprintProvider)
            : null,
        profiles: row?.profiles
            ? (JSON.parse(decryptText(row.profiles)) as VoiceProfile[])
            : [],
    };
}

export async function setVoiceprintProvider(
    userId: string,
    provider: VoiceprintProvider | null,
) {
    const value = provider && encryptText(JSON.stringify(provider));
    await db
        .insert(speakerLibraries)
        .values({ userId, provider: value })
        .onConflictDoUpdate({
            target: speakerLibraries.userId,
            set: { provider: value },
        });
}

export function formatVoiceprintLibrary(profiles: VoiceProfile[]) {
    return { format: "riffado.voiceprints", version: 1, profiles };
}

export async function updateVoiceProfiles(
    userId: string,
    change: (
        profiles: VoiceProfile[],
        provider: VoiceprintProvider | null,
    ) => VoiceProfile[],
) {
    return db.transaction(async (tx) => {
        await tx
            .insert(speakerLibraries)
            .values({ userId })
            .onConflictDoNothing();
        const [row] = await tx
            .select()
            .from(speakerLibraries)
            .where(eq(speakerLibraries.userId, userId))
            .for("update")
            .limit(1);
        const profiles = row.profiles
            ? (JSON.parse(decryptText(row.profiles)) as VoiceProfile[])
            : [];
        const provider = row.provider
            ? (JSON.parse(decryptText(row.provider)) as VoiceprintProvider)
            : null;
        const updated = change(profiles, provider);
        if (updated.length > MAX_PROFILES) {
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "The voiceprint library is full.",
                400,
            );
        }
        await tx
            .update(speakerLibraries)
            .set({ profiles: encryptText(JSON.stringify(updated)) })
            .where(eq(speakerLibraries.userId, userId));
        return updated;
    });
}

export function mergeVoiceProfiles(
    existing: VoiceProfile[],
    incoming: Pick<VoiceProfile, "name" | "samples">[],
): VoiceProfile[] {
    const profiles = new Map(
        existing.map((profile) => [profile.name, profile]),
    );
    for (const { name, samples } of incoming) {
        const profile = profiles.get(name);
        const combined = [...(profile?.samples ?? []), ...samples];
        const unique = new Map(
            combined.map((sample) => [
                JSON.stringify([
                    sample.model.id,
                    sample.model.revision,
                    sample.embedding,
                ]),
                sample,
            ]),
        );
        profiles.set(name, {
            id: profile?.id ?? nanoid(),
            name,
            samples: [...unique.values()].slice(-MAX_SAMPLES),
        });
    }
    return [...profiles.values()];
}
