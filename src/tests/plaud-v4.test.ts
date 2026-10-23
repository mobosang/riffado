import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaudClient } from "@/lib/plaud/client";
import {
    parseSummary,
    parseTranscript,
    selectContentItems,
} from "@/lib/plaud/content";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("@/lib/plaud/fetch", () => ({ plaudFetch: fetchMock }));
vi.mock("@/lib/plaud/workspace", () => ({
    resolveWorkspaceToken: async () => ({
        workspaceToken: "test-workspace-token",
        workspaceId: "test-workspace",
    }),
}));
vi.mock("@/lib/posthog-server", () => ({ captureServerException: vi.fn() }));

const base = "https://api-apne1.plaud.ai";
const migrated = {
    status: -1800907,
    msg: "Account migrated to 4.0. Please update and reinitialize.",
};
const item = (id: string) => ({
    file_id: id,
    name: "Test recording 中文 العربية",
    duration_ms: 60000,
    created_at_show_ms: 1700000000000,
    updated_at_show_ms: 1700000100000,
});
const detail = (id: string) => ({
    status: 0,
    data: {
        node: {
            node_id: `node-${id}`,
            name: "Test recording 中文 العربية",
            version_ms: 1700000100000,
        },
        meta: {
            file_id: id,
            duration: 60000,
            size_bytes: 1024,
            start_time: 1700000000000,
            version_ms: 1700000100000,
        },
        objects: [
            {
                object_id: "audio",
                object_type: "AUDIO",
                content_url: "https://media.example/audio.ogg",
            },
            {
                object_id: "transcript",
                object_type: "TRANSCRIPT",
                content_url: "https://media.example/transcript",
                task_status: 1,
            },
            {
                object_id: "summary",
                object_type: "SUMMARY",
                content_url: "https://media.example/summary",
                task_status: 1,
            },
            {
                object_id: "polish",
                object_type: "POLISHED_TRANSCRIPT",
                content_url: "https://media.example/polish",
                task_status: 1,
            },
        ],
    },
});
const json = (body: unknown) => new Response(JSON.stringify(body));

beforeEach(() => {
    fetchMock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("Plaud v4 compatibility", () => {
    it("switches only on the migration code, follows short cursor pages, and preserves millisecond metadata", async () => {
        fetchMock.mockImplementation(async (url: string) => {
            if (url.includes("/file/simple/web")) return json(migrated);
            if (url.includes("/recordings/all")) {
                const query = new URL(url).searchParams;
                expect(query.get("sort_by")).toBe("updated");
                expect(query.get("sort_order")).toBe("desc");
                expect(query.get("page_size")).toBe("50");
                return json({
                    status: 0,
                    data: query.has("cursor")
                        ? { items: [item("b")], next_cursor: null }
                        : { items: [item("a")], next_cursor: "next&cursor" },
                });
            }
            return json(detail(url.split("/").pop() ?? ""));
        });
        const client = new PlaudClient("test-user-token", base);
        const result = await client.getRecordings(0, 2);
        expect(result.data_file_total).toBe(2);
        expect(result.data_file_list.map((recording) => recording.id)).toEqual([
            "a",
            "b",
        ]);
        expect(result.data_file_list[0]).toMatchObject({
            filename: item("a").name,
            duration: 60000,
            start_time: 1700000000000,
            end_time: 1700000060000,
            filesize: 1024,
            is_trans: true,
            is_summary: true,
        });
        const count = fetchMock.mock.calls.length;
        expect(result.data_file_list[0].serial_number).toBeUndefined();
        expect(result.data_file_list[0].file_md5).toBeUndefined();
        expect(result.data_file_list[0].timezone).toBeUndefined();
        expect(result.data_file_list[0].zonemins).toBeUndefined();
        expect(result.data_file_list[0].scene).toBeUndefined();
        expect((await client.getRecordings(2, 2)).data_file_list).toEqual([]);
        expect(fetchMock).toHaveBeenCalledTimes(count);
        expect(
            fetchMock.mock.calls.filter(([url]) =>
                url.includes("/file/simple/web"),
            ),
        ).toHaveLength(1);
        expect(
            fetchMock.mock.calls.every(
                ([, options]) =>
                    options.headers.Authorization ===
                    "Bearer test-workspace-token",
            ),
        ).toBe(true);
    });

    it("downloads AUDIO without leaking the account authorization to the signed URL", async () => {
        fetchMock
            .mockResolvedValueOnce(json(migrated))
            .mockResolvedValueOnce(json(detail("a")))
            .mockResolvedValueOnce(new Response("OggS-example"));
        const buffer = await new PlaudClient(
            "test-user-token",
            base,
        ).downloadRecording("a", false);
        expect(buffer.toString()).toBe("OggS-example");
        expect(fetchMock.mock.calls[2]).toEqual([
            "https://media.example/audio.ogg",
        ]);
    });

    it("maps v4 content into the existing raw transcript and summary import pipeline", async () => {
        fetchMock
            .mockResolvedValueOnce(json(migrated))
            .mockResolvedValueOnce(json(detail("a")));
        const client = new PlaudClient("test-user-token", base);
        const selected = selectContentItems(await client.getFileDetail("a"));
        expect(selected.transcript?.data_id).toBe("transcript");
        expect(selected.summary?.data_id).toBe("summary");
        fetchMock.mockResolvedValueOnce(
            json([
                {
                    start_time: 0,
                    end_time: 1000,
                    speaker: "Speaker",
                    content: "Hello 中文 العربية",
                },
            ]),
        );
        expect(
            parseTranscript(
                await client.fetchContentLink(
                    selected.transcript?.data_link ?? "",
                ),
            ).text,
        ).toBe("Speaker: Hello 中文 العربية");
        fetchMock.mockResolvedValueOnce(
            json({ ai_content: "Summary 中文 العربية" }),
        );
        expect(
            parseSummary(
                await client.fetchContentLink(
                    selected.summary?.data_link ?? "",
                ),
            ).summary,
        ).toBe("Summary 中文 العربية");
    });

    it("resolves content IDs when the detail does not contain download URLs", async () => {
        const response = detail("a");
        const audio = { object_type: "AUDIO", content_id: "content-a" };
        fetchMock
            .mockResolvedValueOnce(json(migrated))
            .mockResolvedValueOnce(
                json({
                    ...response,
                    data: { ...response.data, objects: [audio] },
                }),
            )
            .mockResolvedValueOnce(
                json({
                    status: 0,
                    data: {
                        url_map: {
                            "content-a": "https://media.example/refreshed",
                        },
                    },
                }),
            );
        expect(
            (await new PlaudClient("test", base).getTempUrl("a")).temp_url,
        ).toBe("https://media.example/refreshed");
        expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
            content_ids: ["content-a"],
        });
    });

    it("rejects malformed content URL maps", async () => {
        const response = detail("a");
        fetchMock
            .mockResolvedValueOnce(json(migrated))
            .mockResolvedValueOnce(
                json({
                    ...response,
                    data: {
                        ...response.data,
                        objects: [
                            { object_type: "AUDIO", content_id: "content-a" },
                        ],
                    },
                }),
            )
            .mockResolvedValueOnce(
                json({ status: 0, data: { url_map: { "content-a": 42 } } }),
            );
        await expect(
            new PlaudClient("test", base).getTempUrl("a"),
        ).rejects.toThrow("invalid v4 response");
    });

    it.each([
        -12345, 401,
    ])("rejects HTTP 200 business error %s without guessing a v4 migration", async (status) => {
        fetchMock.mockResolvedValue(json({ status, msg: "error" }));
        await expect(
            new PlaudClient("test", base).getRecordings(),
        ).rejects.toMatchObject({ details: { plaudStatus: status } });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([
        null,
        { status: 0 },
        { status: 0, data_file_list: {} },
    ])("rejects malformed legacy list %j", async (response) => {
        fetchMock.mockResolvedValue(json(response));
        await expect(
            new PlaudClient("test", base).getRecordings(),
        ).rejects.toThrow("invalid recording list");
    });

    it("rejects cursor loops instead of silently repeating recordings", async () => {
        fetchMock
            .mockResolvedValueOnce(json(migrated))
            .mockImplementation(async () =>
                json({
                    status: 0,
                    data: { items: [item("a")], next_cursor: "same" },
                }),
            );
        await expect(
            new PlaudClient("test", base).getRecordings(0, 2),
        ).rejects.toThrow("repeated a pagination cursor");
    });

    it("rejects missing metadata and never downloads an unvalidated recording", async () => {
        fetchMock
            .mockResolvedValueOnce(json(migrated))
            .mockResolvedValueOnce(
                json({ status: 0, data: { items: [item("a")] } }),
            )
            .mockResolvedValueOnce(
                json({ status: 0, data: { meta: {}, objects: [] } }),
            );
        await expect(
            new PlaudClient("test", base).getRecordings(0, 1),
        ).rejects.toThrow("invalid v4 response");
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("keeps caches isolated between account clients", async () => {
        fetchMock
            .mockResolvedValueOnce(json(migrated))
            .mockResolvedValueOnce(json({ status: 0, data: { items: [] } }))
            .mockResolvedValueOnce(
                json({ status: 0, data_file_total: 0, data_file_list: [] }),
            );
        await new PlaudClient("first", base).getRecordings(0, 1);
        await new PlaudClient("second", base).getRecordings(0, 1);
        expect(fetchMock.mock.calls[2][0]).toContain("/file/simple/web");
    });

    it("excludes pending and safety-blocked content", async () => {
        const response = detail("a");
        response.data.objects[1].task_status = 0;
        fetchMock.mockResolvedValueOnce(json(migrated)).mockResolvedValueOnce(
            json({
                ...response,
                data: {
                    ...response.data,
                    objects: response.data.objects.map((object) =>
                        object.object_type === "SUMMARY"
                            ? { ...object, safe_scan_status: 2 }
                            : object,
                    ),
                },
            }),
        );
        const selected = selectContentItems(
            await new PlaudClient("test", base).getFileDetail("a"),
        );
        expect(selected).toEqual({ summary: undefined });
    });
});
