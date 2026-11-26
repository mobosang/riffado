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

it("enrolls a speaker from the recording action", async () => {
    const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
            Response.json({
                candidates: [
                    {
                        speaker: "说话人 1",
                        proof: "sealed-proof",
                        clips: [{ start: 1, text: "片段", preview: "YQ==" }],
                    },
                ],
            }),
        )
        .mockResolvedValueOnce(Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceprintButton recordingId="test-recording" />);
    fireEvent.click(
        screen.getByRole("button", { name: "Generate voiceprints" }),
    );
    const input = await screen.findByRole("textbox", { name: "Speaker name" });
    fireEvent.change(input, { target: { value: "王工" } });
    fireEvent.click(screen.getByRole("button", { name: "Save voiceprints" }));
    expect(await screen.findByRole("button", { name: "Saved" })).toBeDefined();
    expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/recordings/test-recording/voiceprints",
        expect.objectContaining({
            method: "PUT",
            body: JSON.stringify({ name: "王工", proof: "sealed-proof" }),
        }),
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
