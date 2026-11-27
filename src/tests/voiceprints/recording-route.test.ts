import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    GET,
    PATCH,
    POST,
    PUT,
} from "@/app/api/recordings/[id]/voiceprints/route";
import { db } from "@/db";
import { type recordings, transcriptions } from "@/db/schema";
import { encryptJSON } from "@/lib/encryption";
import { decryptText, encryptText } from "@/lib/encryption/fields";
import { env } from "@/lib/env";
import { createUserStorageProvider } from "@/lib/storage/factory";
import type {
    RecordingVoiceprints,
    VoiceProfile,
    VoiceprintCandidate,
    VoiceSample,
} from "@/lib/voiceprints/format";
import {
    getVoiceprintLibrary,
    updateVoiceProfiles,
} from "@/lib/voiceprints/library";
import type { TranscriptNameEditor } from "@/lib/voiceprints/transcript";

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
vi.mock("@/db", () => ({ db: { select: vi.fn(), transaction: vi.fn() } }));
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
let transcript: { id: string; text: string } | undefined;
const write = vi.fn();
const savedProfile: VoiceProfile = {
    id: "profile-a",
    name: "王工",
    samples: [sample],
};
const originalText = [
    "[00:00:00] 说话人 1：请保留正文里的说话人 1",
    "[00:00:03] 说话人 1 ：  项目进展",
    "[00:00:08] 说话人 2：未指派的发言",
    "[00:00:10] 说话人待确认：保留",
    "[00:00:12] 李工（说话人 3）：保留已有姓名",
    "",
].join("\r\n");

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
    transcript = undefined;
    vi.mocked(db.select).mockReturnValue({
        from: (table: typeof recordings | typeof transcriptions) => ({
            where: () => {
                const query = {
                    limit: async () =>
                        table === transcriptions
                            ? transcript
                                ? [transcript]
                                : []
                            : [{ storagePath: "audio", duration: 20_000 }],
                    for: () => query,
                };
                return query;
            },
        }),
    } as unknown as ReturnType<typeof db.select>);
    vi.mocked(db.transaction).mockImplementation(async (callback) =>
        callback({
            select: db.select,
            update: (table: typeof transcriptions | typeof recordings) => ({
                set: (values: object) => ({
                    where: async (condition: SQL) =>
                        write(table, values, condition),
                }),
            }),
        } as unknown as Parameters<typeof callback>[0]),
    );
    vi.mocked(getVoiceprintLibrary).mockImplementation(async () => ({
        provider,
        profiles,
    }));
    vi.mocked(updateVoiceProfiles).mockImplementation(async (_id, update) => {
        profiles = update(profiles, provider);
        return profiles;
    });
});

describe("applying voiceprint names to a transcript", () => {
    async function loadEditor(): Promise<TranscriptNameEditor> {
        const response = await GET(new Request(`${url}?transcript=1`), context);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        const { transcript } = await response.json();
        return transcript;
    }

    function applyName(revision: string, profileId: string) {
        return PATCH(
            new Request(url, {
                method: "PATCH",
                body: JSON.stringify({
                    revision,
                    assignments: [{ speaker: "说话人 1", profileId }],
                }),
            }),
            context,
        );
    }

    beforeEach(() => {
        transcript = { id: "transcript-a", text: encryptText(originalText) };
        profiles = [{ ...savedProfile, name: "أحمد（研发）" }];
    });

    it("suggests a saved name and persists only the selected speaker's text labels", async () => {
        const editor = await loadEditor();
        expect(editor.speakers).toMatchObject([
            { speaker: "说话人 1", suggestedProfileId: "profile-a" },
            { speaker: "说话人 2" },
            { speaker: "说话人 3", name: "李工" },
        ]);
        expect(editor.speakers[1].suggestedProfileId).toBeUndefined();
        expect((await applyName(editor.revision, "profile-a")).ok).toBe(true);
        const [table, values, scope] = write.mock.calls[0];
        expect(table).toBe(transcriptions);
        expect(Object.keys(values)).toEqual(["text"]);
        expect(values.text).not.toContain("أحمد");
        expect(decryptText(values.text)).toBe(
            originalText
                .replace("] 说话人 1：", "] أحمد（研发）（说话人 1）：")
                .replace("] 说话人 1 ：", "] أحمد（研发）（说话人 1） ："),
        );
        expect(new PgDialect().sqlToQuery(scope).params).toEqual([
            "transcript-a",
            "user-a",
            "rec-a",
            "riffado",
        ]);
        expect(createUserStorageProvider).not.toHaveBeenCalled();
        expect(updateVoiceProfiles).not.toHaveBeenCalled();
    });

    it("leaves a sample spanning a speaker change for manual confirmation", async () => {
        profiles = [
            {
                ...savedProfile,
                samples: [
                    {
                        ...sample,
                        source: { recordingId: "rec-a", start: 5, end: 9 },
                    },
                ],
            },
        ];
        const editor = await loadEditor();
        expect(editor.speakers[0].speaker).toBe("说话人 1");
        expect(editor.speakers[0].suggestedProfileId).toBeUndefined();
        expect(editor.speakers[1].suggestedProfileId).toBeUndefined();
    });

    it("rejects an assignment to a profile from another recording", async () => {
        profiles.push({
            ...savedProfile,
            id: "profile-b",
            samples: [
                {
                    ...sample,
                    source: { recordingId: "rec-b", start: 1, end: 5 },
                },
            ],
        });
        const { revision } = await loadEditor();
        expect((await applyName(revision, "profile-b")).status).toBe(400);
        expect(write).not.toHaveBeenCalled();
    });

    it("rejects stale confirmations after a transcript or voiceprint name changes", async () => {
        const { revision } = await loadEditor();
        transcript = {
            id: "transcript-a",
            text: encryptText("New transcription"),
        };
        expect((await applyName(revision, "profile-a")).status).toBe(409);
        const updated = await loadEditor();
        profiles = [{ ...savedProfile, name: "New name" }];
        expect((await applyName(updated.revision, "profile-a")).status).toBe(
            409,
        );
        expect(write).not.toHaveBeenCalled();
    });
});

describe("voiceprint enrollment", () => {
    it("reads only the current recording's saved profiles with no model configured", async () => {
        profiles = [
            {
                ...savedProfile,
                samples: [sample, { ...sample, source: undefined }],
            },
            {
                ...savedProfile,
                id: "profile-b",
                name: "李工",
                samples: [
                    {
                        ...sample,
                        source: { recordingId: "rec-b", start: 1, end: 5 },
                    },
                ],
            },
        ];
        vi.mocked(getVoiceprintLibrary).mockResolvedValueOnce({
            provider: null,
            profiles,
        });
        const response = await GET(new Request(url), context);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(await response.json()).toEqual({
            saved: [{ id: "profile-a", name: "王工", sampleCount: 1 }],
            candidates: [],
        });
        expect(getVoiceprintLibrary).toHaveBeenCalledWith("user-a");
        expect(createUserStorageProvider).not.toHaveBeenCalled();
    });

    it("reuses saved data even if it was enrolled after the UI checked", async () => {
        const initial = await GET(new Request(url), context);
        expect((await initial.json()).saved).toEqual([]);
        profiles = [savedProfile];
        const response = await POST(
            new Request(url, { method: "POST" }),
            context,
        );
        expect(await response.json()).toEqual({
            saved: [{ id: "profile-a", name: "王工", sampleCount: 1 }],
            candidates: [],
        });
        expect(createUserStorageProvider).not.toHaveBeenCalled();
    });

    it("allows explicit extraction on a recording with saved voiceprints", async () => {
        profiles = [savedProfile];
        const response = await POST(
            new Request(`${url}?regenerate=1`, { method: "POST" }),
            context,
        );
        const result: RecordingVoiceprints = await response.json();
        expect(response.status).toBe(200);
        expect(result.saved).toHaveLength(1);
        expect(result.candidates).toHaveLength(1);
        expect(createUserStorageProvider).toHaveBeenCalledWith("user-a");
    });

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
