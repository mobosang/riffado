/** @vitest-environment jsdom */

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConfirmDialogProvider } from "@/components/confirm-dialog";
import { VoiceprintButton } from "@/components/dashboard/voiceprint-button";
import { VoiceprintSettings } from "@/components/settings-sections/voiceprint-settings";
import { usePlaybackKeyboard } from "@/hooks/use-playback-keyboard";
import { CAMPPLUS_MODEL } from "@/lib/voiceprints/format";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const recordingEndpoint = "/api/recordings/test-recording/voiceprints";
const savedVoiceprints = {
    saved: [{ id: "speaker-a", name: "王工", sampleCount: 1 }],
    candidates: [],
};
const extractedVoiceprints = {
    saved: [],
    candidates: [
        {
            speaker: "说话人 1",
            proof: "sealed-proof",
            clips: [{ start: 1, text: "片段", preview: "YQ==" }],
        },
    ],
};

it("generates new samples once and opens saved voiceprints without generating again", async () => {
    const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ saved: [], candidates: [] }))
        .mockResolvedValueOnce(Response.json(extractedVoiceprints))
        .mockResolvedValueOnce(
            Response.json({ success: true, saved: savedVoiceprints.saved }),
        )
        .mockResolvedValueOnce(Response.json(savedVoiceprints));
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceprintButton recordingId="test-recording" />);
    fireEvent.click(screen.getByRole("button", { name: "Voiceprints" }));
    const input = await screen.findByRole("textbox", { name: "Speaker name" });
    fireEvent.change(input, { target: { value: "王工" } });
    fireEvent.click(screen.getByRole("button", { name: "Save voiceprints" }));
    expect(await screen.findByRole("button", { name: "Saved" })).toBeDefined();
    expect(
        screen.getByRole("button", { name: "Apply names to this transcript" }),
    ).toBeDefined();
    expect(fetchMock).toHaveBeenLastCalledWith(
        recordingEndpoint,
        expect.objectContaining({
            method: "PUT",
            body: JSON.stringify({ name: "王工", proof: "sealed-proof" }),
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Voiceprints" }));
    expect(await screen.findByText("王工")).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "Speaker name" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        recordingEndpoint,
        expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
        recordingEndpoint,
        expect.objectContaining({ method: "GET" }),
    );
});

it("reviews a suggested name and applies a manual selection without re-extracting", async () => {
    const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(Response.json(savedVoiceprints))
        .mockResolvedValueOnce(
            Response.json({
                saved: savedVoiceprints.saved,
                transcript: {
                    revision: "revision-a",
                    speakers: [
                        {
                            speaker: "说话人 1",
                            timestamp: "00:00:00",
                            excerpt: "导入发言",
                            preview: {
                                start: 0,
                                end: 6,
                                sharedTimestamp: false,
                            },
                            suggestedProfileId: "speaker-a",
                        },
                        {
                            speaker: "说话人 2",
                            timestamp: "00:00:07",
                            excerpt: "稍后发言",
                            preview: {
                                start: 7,
                                end: 13,
                                sharedTimestamp: false,
                            },
                        },
                    ],
                },
            }),
        )
        .mockResolvedValueOnce(Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceprintButton recordingId="test-recording" />);
    fireEvent.click(screen.getByRole("button", { name: "Voiceprints" }));
    fireEvent.click(
        await screen.findByRole("button", {
            name: "Apply names to this transcript",
        }),
    );
    const first = await screen.findByRole<HTMLSelectElement>("combobox", {
        name: "说话人 1",
    });
    expect(first.value).toBe("speaker-a");
    fireEvent.change(first, { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "说话人 2" }), {
        target: { value: "speaker-a" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply names" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenLastCalledWith(
        recordingEndpoint,
        expect.objectContaining({
            method: "PATCH",
            body: JSON.stringify({
                revision: "revision-a",
                assignments: [{ speaker: "说话人 2", profileId: "speaker-a" }],
            }),
        }),
    );
});

it("reads a previous session's saved voiceprints and extracts only on request", async () => {
    const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(Response.json(savedVoiceprints))
        .mockResolvedValueOnce(
            Response.json({
                ...savedVoiceprints,
                candidates: extractedVoiceprints.candidates,
            }),
        );
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceprintButton recordingId="test-recording" />);
    fireEvent.click(screen.getByRole("button", { name: "Voiceprints" }));
    expect(await screen.findByText("王工")).toBeDefined();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        recordingEndpoint,
        expect.objectContaining({ method: "GET" }),
    );

    fireEvent.click(
        screen.getByRole("button", { name: "Extract voiceprints again" }),
    );
    expect(
        await screen.findByRole("textbox", { name: "Speaker name" }),
    ).toBeDefined();
    expect(fetchMock).toHaveBeenLastCalledWith(
        `${recordingEndpoint}?regenerate=1`,
        expect.objectContaining({ method: "POST" }),
    );
});

it("plays only the selected speaker's original segment and stops at the end or on close", async () => {
    const started = vi
        .spyOn(HTMLMediaElement.prototype, "play")
        .mockResolvedValue(undefined);
    const paused = vi
        .spyOn(HTMLMediaElement.prototype, "pause")
        .mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(Response.json(savedVoiceprints))
        .mockResolvedValueOnce(
            Response.json({
                saved: savedVoiceprints.saved,
                transcript: {
                    revision: "revision-a",
                    speakers: [
                        {
                            speaker: "Speaker 1",
                            timestamp: "00:00:04",
                            excerpt: "Original speech",
                            preview: {
                                start: 4,
                                end: 10,
                                sharedTimestamp: false,
                            },
                        },
                        {
                            speaker: "Speaker 2",
                            timestamp: "00:08:33",
                            excerpt: "Another speaker",
                            preview: {
                                start: 513,
                                end: 516,
                                sharedTimestamp: false,
                            },
                        },
                    ],
                },
            }),
        );
    vi.stubGlobal("fetch", fetchMock);
    const onVolumeDelta = vi.fn();

    function PlayerWithShortcuts() {
        usePlaybackKeyboard({
            onToggle: vi.fn(),
            onSeekRelative: vi.fn(),
            onVolumeDelta,
        });
        return <VoiceprintButton recordingId="test-recording" />;
    }

    render(<PlayerWithShortcuts />);
    fireEvent.click(screen.getByRole("button", { name: "Voiceprints" }));
    fireEvent.click(
        await screen.findByRole("button", {
            name: "Apply names to this transcript",
        }),
    );
    const firstButton = await screen.findByRole("button", {
        name: "Play original audio for Speaker 1",
    });
    expect(started).not.toHaveBeenCalled();
    fireEvent.click(firstButton);
    const firstAudio = started.mock.contexts[0] as HTMLAudioElement;
    expect(firstAudio.getAttribute("src")).toBe(
        "/api/recordings/test-recording/audio?stream=1#t=4,10",
    );
    expect(firstAudio.currentTime).toBe(4);
    const choice = screen.getByRole<HTMLSelectElement>("combobox", {
        name: "Speaker 2",
    });
    fireEvent.keyDown(choice, { key: "ArrowDown" });
    expect(onVolumeDelta).not.toHaveBeenCalled();
    fireEvent.change(choice, { target: { value: "speaker-a" } });

    fireEvent.click(
        screen.getByRole("button", {
            name: "Play original audio for Speaker 2",
        }),
    );
    expect(paused.mock.contexts).toContain(firstAudio);
    expect(firstAudio.getAttribute("src")).toBeNull();
    const secondAudio = started.mock.contexts[1] as HTMLAudioElement;
    expect(secondAudio.currentTime).toBe(513);
    fireEvent.error(firstAudio);
    expect(screen.queryByRole("alert")).toBeNull();
    secondAudio.currentTime = 516;
    fireEvent.timeUpdate(secondAudio);
    expect(paused.mock.contexts).toContain(secondAudio);
    expect(choice.value).toBe("speaker-a");

    fireEvent.click(
        screen.getByRole("button", {
            name: "Play original audio for Speaker 2",
        }),
    );
    const replay = started.mock.contexts[2] as HTMLAudioElement;
    fireEvent.error(replay);
    expect(screen.getByRole("alert").textContent).toContain(
        "Failed to play audio",
    );
    fireEvent.click(
        screen.getByRole("button", {
            name: "Play original audio for Speaker 1",
        }),
    );
    const lastAudio = started.mock.contexts[3] as HTMLAudioElement;
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(paused.mock.contexts).toContain(lastAudio);
    expect(lastAudio.getAttribute("src")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("saves the configured voiceprint model with the local preset", async () => {
    const getBody = {
        provider: null,
        diarizationAvailable: true,
        profiles: [],
    };
    const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(Response.json(getBody))
        .mockResolvedValueOnce(Response.json({ success: true }))
        .mockResolvedValueOnce(
            Response.json({
                ...getBody,
                provider: {
                    name: "Nemotron 3 Diarization + CAM++",
                    endpoint: "http://voiceprints:9021/embed",
                    model: CAMPPLUS_MODEL,
                },
            }),
        );
    vi.stubGlobal("fetch", fetchMock);
    render(
        <ConfirmDialogProvider>
            <VoiceprintSettings />
        </ConfirmDialogProvider>,
    );
    fireEvent.click(
        await screen.findByRole("button", { name: "Add voiceprint service" }),
    );
    expect(
        (screen.getByLabelText("Voiceprint model ID") as HTMLInputElement)
            .value,
    ).toBe(CAMPPLUS_MODEL);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
        expect(
            screen.getByText("Nemotron 3 Diarization + CAM++"),
        ).toBeDefined(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "/api/settings/ai/voiceprints",
        expect.objectContaining({ method: "PUT" }),
    );
});
