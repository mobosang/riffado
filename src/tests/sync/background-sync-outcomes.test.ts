import { afterEach, expect, it, vi } from "vitest";
import { startBackgroundSyncWorker } from "@/lib/sync/worker";

const { sync, capture } = vi.hoisted(() => ({
    sync: vi.fn(),
    capture: vi.fn(),
}));
vi.mock("@/lib/env", () => ({
    env: {
        IS_HOSTED: false,
        BACKGROUND_SYNC_ENABLED: true,
        BACKGROUND_SYNC_INTERVAL_MS: 300000,
    },
}));
vi.mock("@/lib/posthog-server", () => ({ captureServerException: capture }));
vi.mock("@/lib/sync/sync-recordings", () => ({ syncRecordingsForUser: sync }));
vi.mock("@/db", () => ({
    db: {
        select: () => ({
            from: () => ({
                innerJoin: () => ({
                    where: () => ({
                        orderBy: () => ({
                            limit: async () =>
                                [
                                    "ok",
                                    "partial",
                                    "skipped",
                                    "inflight",
                                    "throw",
                                ].map((userId) => ({ userId })),
                        }),
                    }),
                }),
            }),
        }),
    },
}));

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

it("counts returned failures without logging private recording names or double-reporting telemetry", async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    sync.mockResolvedValueOnce({ errors: [] })
        .mockResolvedValueOnce({ errors: ["private recording filename"] })
        .mockResolvedValueOnce({
            errors: ["not connected"],
            skipped: "no_connection",
        })
        .mockResolvedValueOnce({ errors: [], inProgress: true })
        .mockRejectedValueOnce(new Error("connection failed"));
    startBackgroundSyncWorker();
    await vi.advanceTimersByTimeAsync(30000);
    expect(log).toHaveBeenCalledWith("[background-sync] synced=1 errors=2");
    expect(error).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(error.mock.calls)).not.toContain(
        "private recording filename",
    );
    expect(capture).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledTimes(5);
});
