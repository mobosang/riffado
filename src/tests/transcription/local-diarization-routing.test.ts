import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
    apiCredentials,
    recordings,
    transcriptions,
    userSettings,
} from "@/db/schema";
import { env } from "@/lib/env";
import { upsertTranscription } from "@/lib/transcription/persist";
import { transcribeRecording } from "@/lib/transcription/transcribe-recording";

const state = vi.hoisted(() => ({
    enabled: true,
    existing: false,
    uploaded: false,
    credential: true,
    plain: vi.fn(),
    set: vi.fn(),
    where: vi.fn(),
}));
vi.mock("@/db", () => ({
    db: { select: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/env", () => ({
    env: {
        IS_HOSTED: false,
        RIFFADO_PLAUD_DIARIZATION_URL: "http://local-asr/transcribe",
        WHISPER_MAX_BYTES: 24000000,
    },
}));
vi.mock("@/lib/encryption", () => ({ decrypt: () => "key" }));
vi.mock("@/lib/encryption/fields", () => ({
    decryptText: (v: string) => v,
    encryptText: (v: string) => v,
}));
vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: async () => ({
        downloadFile: async () => Buffer.from("audio"),
    }),
}));
vi.mock("@/lib/entitlements", () => ({ isHostedLockedOut: async () => false }));
vi.mock("@/lib/hosted/transcription/mynah", () => ({
    isMynahConfigured: () => false,
    transcribeViaMynah: vi.fn(),
}));
vi.mock("@/lib/posthog-server", () => ({
    captureServerEvent: vi.fn(),
    captureServerException: vi.fn(),
}));
vi.mock("@/lib/webhooks/emit", () => ({ emitEvent: vi.fn() }));
vi.mock("@/lib/ai/generate-title", () => ({
    generateTitleFromTranscription: vi.fn(),
}));
vi.mock("@/lib/plaud/client-factory", () => ({ createPlaudClient: vi.fn() }));
vi.mock("@/lib/summary/generate-summary", () => ({
    generateSummaryForRecording: vi.fn(),
}));
vi.mock("@/lib/transcription/persist", () => ({
    upsertTranscription: vi.fn(async () => ({ committed: true })),
}));
vi.mock("@/lib/transcription/openai-client", () => ({
    createTranscriptionClient: () => ({
        audio: { transcriptions: { create: state.plain } },
    }),
}));

describe("speaker switch in shared transcription entry point", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.enabled = true;
        state.existing = false;
        state.uploaded = false;
        state.credential = true;
        env.IS_HOSTED = false;
        state.plain.mockResolvedValue({ text: "plain", language: "en" });
        state.where.mockResolvedValue(undefined);
        state.set.mockReturnValue({ where: state.where });
        vi.mocked(db.update).mockReturnValue({
            set: state.set,
        } as unknown as ReturnType<typeof db.update>);
        vi.mocked(db.delete).mockReturnValue({
            where: state.where,
        } as unknown as ReturnType<typeof db.delete>);
        vi.mocked(db.select).mockImplementation(
            () =>
                ({
                    from: (table: unknown) => ({
                        where: () => ({
                            limit: async () => {
                                if (table === recordings)
                                    return [
                                        {
                                            id: "rec",
                                            userId: "user",
                                            filename: "test.wav",
                                            storagePath: "test.wav",
                                            duration: 1000,
                                            filesize: 5,
                                            updatedAt: new Date(0),
                                            deletedAt: null,
                                            createdAt: new Date(0),
                                            plaudFileId: state.uploaded
                                                ? "uploaded-test"
                                                : "f_test",
                                            deviceSn: state.uploaded
                                                ? "local"
                                                : "plaud",
                                        },
                                    ];
                                if (table === transcriptions)
                                    return state.existing
                                        ? [
                                              {
                                                  text: "old",
                                                  detectedLanguage: null,
                                              },
                                          ]
                                        : [];
                                if (table === userSettings)
                                    return [
                                        {
                                            speakerDiarization: state.enabled,
                                            autoGenerateTitle: false,
                                            autoSummarize: false,
                                        },
                                    ];
                                if (table === apiCredentials)
                                    return state.credential
                                        ? [
                                              {
                                                  id: "provider",
                                                  provider: "custom",
                                                  apiKey: "key",
                                                  defaultModel: "whisper-1",
                                              },
                                          ]
                                        : [];
                                return [];
                            },
                        }),
                    }),
                }) as unknown as ReturnType<typeof db.select>,
        );
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                Response.json({
                    segments: [
                        {
                            start: 0,
                            end: 1,
                            speaker: "说话人 1",
                            text: "hello",
                        },
                    ],
                }),
            ),
        );
    });
    it.each([
        ["automatic sync", "sync", false, false],
        ["manual", "manual", true, false],
        ["re-transcribe", "manual", true, true],
        ["uploaded audio", "manual", true, false],
    ] as const)("uses local recognition for %s", async (name, trigger, force, existing) => {
        state.existing = existing;
        state.uploaded = name === "uploaded audio";
        const result = await transcribeRecording("user", "rec", {
            trigger,
            force,
        });
        expect(result.success).toBe(true);
        expect(result.text).toContain("说话人 1");
        expect(upsertTranscription).toHaveBeenCalledWith(
            expect.objectContaining({
                source: "riffado",
                provider: "local-diarization",
            }),
        );
        expect(state.plain).not.toHaveBeenCalled();
    });
    it("keeps existing data and persists an explicit failure without calling plain ASR", async () => {
        state.existing = true;
        vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
        const result = await transcribeRecording("user", "rec", {
            force: true,
        });
        expect(result).toMatchObject({
            success: false,
            errorCode: "DIARIZATION_FAILED",
            providerStatus: 503,
        });
        expect(state.set).toHaveBeenCalledWith({
            transcriptionError: "DIARIZATION_FAILED",
        });
        expect(upsertTranscription).not.toHaveBeenCalled();
        expect(db.delete).not.toHaveBeenCalled();
        expect(state.plain).not.toHaveBeenCalled();
    });
    it("uses ordinary ASR with the switch off", async () => {
        state.enabled = false;
        expect(
            (await transcribeRecording("user", "rec", { force: true })).text,
        ).toBe("plain");
        expect(fetch).not.toHaveBeenCalled();
    });
    it("never invokes the local endpoint in hosted mode", async () => {
        env.IS_HOSTED = true;
        expect(
            (await transcribeRecording("user", "rec", { force: true })).text,
        ).toBe("plain");
        expect(fetch).not.toHaveBeenCalled();
    });
    it("rejects an explicit missing or foreign provider before sending audio", async () => {
        state.credential = false;
        expect(
            await transcribeRecording("user", "rec", {
                providerId: "foreign",
                force: true,
            }),
        ).toMatchObject({
            success: false,
            errorCode: "NO_TRANSCRIPTION_PROVIDER",
        });
        expect(fetch).not.toHaveBeenCalled();
    });
    it("does not overwrite an existing transcript during automatic sync", async () => {
        state.existing = true;
        expect(
            (await transcribeRecording("user", "rec", { trigger: "sync" }))
                .text,
        ).toBe("old");
        expect(fetch).not.toHaveBeenCalled();
    });
});
