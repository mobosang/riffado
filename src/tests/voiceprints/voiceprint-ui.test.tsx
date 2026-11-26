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
import { CAMPPLUS_MODEL } from "@/lib/voiceprints/format";

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
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
        .mockResolvedValueOnce(Response.json({ success: true }))
        .mockResolvedValueOnce(Response.json(savedVoiceprints));
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceprintButton recordingId="test-recording" />);
    fireEvent.click(screen.getByRole("button", { name: "Voiceprints" }));
    const input = await screen.findByRole("textbox", { name: "Speaker name" });
    fireEvent.change(input, { target: { value: "王工" } });
    fireEvent.click(screen.getByRole("button", { name: "Save voiceprints" }));
    expect(await screen.findByRole("button", { name: "Saved" })).toBeDefined();
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
