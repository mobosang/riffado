import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST, PUT } from "@/app/api/recordings/[id]/voiceprints/route";
import { db } from "@/db";
import { encryptJSON } from "@/lib/encryption";
import { env } from "@/lib/env";
import type {
    VoiceProfile,
    VoiceprintCandidate,
    VoiceSample,
} from "@/lib/voiceprints/format";
import {
    getVoiceprintLibrary,
    updateVoiceProfiles,
} from "@/lib/voiceprints/library";

vi.mock("@/lib/auth-server", () => ({
    requireApiSession: async () => ({ user: { id: "user-a" } }),
}));
vi.mock("@/lib/env", () => ({
    env: {
        IS_HOSTED: false,
        ENCRYPTION_KEY: "d".repeat(64),
        RIFFADO_PLAUD_DIARIZATION_URL: "http://diarization/transcribe",
    },
}));
vi.mock("@/db", () => ({ db: { select: vi.fn() } }));
vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn(),
}));
vi.mock("@/lib/storage/download-limited", () => ({
    downloadFileWithLimit: async () => Buffer.from("test-audio"),
}));
vi.mock("@/lib/transcription/plaud-diarization", () => ({
    isLocalDiarizationEnabled: () => true,
    getDiarizedSegments: async () => [],
}));
vi.mock("@/lib/voiceprints/extract", () => ({
    extractSpeakerSamples: async () =>
        new Map([
            [
                "说话人 1",
                {
                    samples: [sample],
                    clips: [{ start: 1, text: "测试", preview: "YQ==" }],
                },
            ],
        ]),
}));
vi.mock("@/lib/voiceprints/library", async (original) => ({
    ...(await original<object>()),
    getVoiceprintLibrary: vi.fn(),
    updateVoiceProfiles: vi.fn(),
}));

const context = { params: Promise.resolve({ id: "rec-a" }) };
const url = "http://riffado.test/api/recordings/rec-a/voiceprints";
const provider = {
    endpoint: "http://encoder/embed",
    name: "Encoder",
    model: "vendor/model",
};
const sample: VoiceSample = {
    model: { id: provider.model, revision: "v1", dimension: 2 },
    embedding: [1, 0],
    source: { recordingId: "rec-a", start: 1, end: 5 },
};
let profiles: VoiceProfile[];

function save(proof: string, name = "王工") {
    return PUT(
        new Request(url, {
            method: "PUT",
            body: JSON.stringify({ proof, name }),
        }),
        context,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    env.IS_HOSTED = false;
    profiles = [];
    vi.mocked(db.select).mockReturnValue({
        from: () => ({
            where: () => ({
                limit: async () => [{ storagePath: "audio", duration: 6000 }],
            }),
        }),
    } as unknown as ReturnType<typeof db.select>);
    vi.mocked(getVoiceprintLibrary).mockResolvedValue({ provider, profiles });
    vi.mocked(updateVoiceProfiles).mockImplementation(async (_id, update) => {
        profiles = update(profiles, provider);
    });
});

describe("voiceprint enrollment", () => {
    it("returns an opaque proof, saves it for the owner, and handles retries", async () => {
        const generated = await POST(
            new Request(url, { method: "POST" }),
            context,
        );
        const result: { candidates: VoiceprintCandidate[] } =
            await generated.json();
        expect(generated.status).toBe(200);
        expect(generated.headers.get("cache-control")).toBe(
            "private, no-store",
        );
        expect(result.candidates[0]).not.toHaveProperty("samples");

        const { proof } = result.candidates[0];
        expect((await save(proof)).ok).toBe(true);
        expect((await save(proof)).ok).toBe(true);
        expect(profiles).toHaveLength(1);
        expect(profiles[0]).toMatchObject({ name: "王工", samples: [sample] });
        expect(updateVoiceProfiles).toHaveBeenCalledWith(
            "user-a",
            expect.any(Function),
        );
        expect((await save(proof, "李工")).status).toBe(409);
    });

    it.each([
        { userId: "user-b" },
        { recordingId: "rec-b" },
        { expiresAt: 1 },
    ])("rejects invalid enrollment scope or age: %j", async (override) => {
        const proof = encryptJSON({
            type: "riffado.voiceprint-enrollment",
            userId: "user-a",
            recordingId: "rec-a",
            expiresAt: Date.now() + 60_000,
            endpoint: provider.endpoint,
            model: provider.model,
            samples: [sample],
            ...override,
        });
        expect((await save(proof)).status).toBe(400);
        expect(updateVoiceProfiles).not.toHaveBeenCalled();
    });

    it("does not access speakers or audio on hosted Riffado", async () => {
        env.IS_HOSTED = true;
        expect(
            (await POST(new Request(url, { method: "POST" }), context)).status,
        ).toBe(403);
        expect(db.select).not.toHaveBeenCalled();
    });
});
