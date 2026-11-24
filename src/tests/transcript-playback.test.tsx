// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingPlayer } from "@/components/dashboard/recording-player";
import { SpeakerTranscript } from "@/components/recordings/rich-content";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Recording } from "@/types/recording";

const recording: Recording = {
    id: "transcript-playback-test",
    filename: "Test recording",
    duration: 248_000,
    startTime: "2026-11-18T13:56:00Z",
    filesize: 1024,
    deviceSn: "local",
};

const text = [
    "[00:00:03] 说话人 1：开场",
    "[00:12] Speaker 2 · Part 1",
    "A second turn / مرحبا",
    "[00:00:23] 重叠发言：结尾",
].join("\n");

function player(value: Recording, transcript = text) {
    return (
        <TooltipProvider>
            <RecordingPlayer recording={value} scrubberStyle="slider">
                <SpeakerTranscript key={value.id} text={transcript} />
            </RecordingPlayer>
        </TooltipProvider>
    );
}

function openPlayer() {
    const view = render(player(recording));
    const audio = view.container.querySelector("audio");
    if (!audio) throw new Error("Missing player audio");
    return { ...view, audio };
}

function loadMetadata(audio: HTMLAudioElement) {
    Object.defineProperties(audio, {
        duration: { configurable: true, value: 248 },
        readyState: {
            configurable: true,
            value: HTMLMediaElement.HAVE_METADATA,
        },
    });
    fireEvent.loadedMetadata(audio);
}

function simulatePlayback(audio: HTMLAudioElement, seconds: number) {
    audio.currentTime = seconds;
    fireEvent.timeUpdate(audio);
}

describe("transcript playback", () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        vi.stubGlobal(
            "ResizeObserver",
            class {
                observe() {}
                unobserve() {}
                disconnect() {}
            },
        );
        vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(
            () => {},
        );
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        window.sessionStorage.clear();
    });

    it("highlights each timed turn, follows it within the transcript, and seeks from a clicked row", () => {
        const { audio, container } = openPlayer();
        loadMetadata(audio);
        const opening = screen.getByRole("button", { name: /开场/ });
        const second = screen.getByRole("button", { name: /A second turn/ });
        const ending = screen.getByRole("button", { name: /结尾/ });
        const viewport = ending.parentElement;
        if (!viewport) throw new Error("Missing transcript viewport");
        const scroll = vi.fn(({ top = 0 }: ScrollToOptions) => {
            viewport.scrollTop += top;
        });
        Object.defineProperties(viewport, {
            clientHeight: { value: 120 },
            scrollBy: { value: scroll },
        });
        for (const [index, row] of [opening, second, ending].entries()) {
            vi.spyOn(row, "getBoundingClientRect").mockImplementation(
                () =>
                    new DOMRect(
                        0,
                        16 + index * 72 - viewport.scrollTop,
                        300,
                        32,
                    ),
            );
        }

        expect(container.querySelector('[aria-current="time"]')).toBeNull();
        simulatePlayback(audio, 7);
        expect(opening.getAttribute("aria-current")).toBe("time");
        expect(scroll).not.toHaveBeenCalled();
        simulatePlayback(audio, 12);
        expect(second.getAttribute("aria-current")).toBe("time");

        const follow = screen.getByRole("switch", { name: "Follow playback" });
        fireEvent.click(follow);
        scroll.mockClear();
        simulatePlayback(audio, 24);
        expect(ending.getAttribute("aria-current")).toBe("time");
        expect(scroll).not.toHaveBeenCalled();
        fireEvent.click(follow);
        expect(viewport.scrollTop).toBeGreaterThan(0);

        simulatePlayback(audio, 0);
        expect(viewport.scrollTop).toBe(0);
        expect(ending.hasAttribute("aria-current")).toBe(false);

        simulatePlayback(audio, 24);
        fireEvent.click(opening);
        expect(audio.currentTime).toBe(3);
        expect(opening.getAttribute("aria-current")).toBe("time");
        expect(ending.hasAttribute("aria-current")).toBe(false);
        expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    });

    it("keeps a clicked timestamp while audio metadata and a fallback source are loading", () => {
        const { audio } = openPlayer();
        fireEvent.click(screen.getByRole("button", { name: /结尾/ }));
        expect(audio.currentTime).toBe(0);
        fireEvent.error(audio);
        expect(audio.getAttribute("src")).toContain("?stream=1");
        loadMetadata(audio);
        expect(audio.currentTime).toBe(23);
    });

    it("keeps playback position and pending seeks scoped to the selected recording", () => {
        const { audio, container, rerender } = openPlayer();
        fireEvent.click(screen.getByRole("button", { name: /结尾/ }));
        rerender(player({ ...recording, id: "another-recording" }));
        loadMetadata(audio);
        expect(audio.currentTime).toBe(0);
        expect(container.querySelector('[aria-current="time"]')).toBeNull();

        simulatePlayback(audio, 24);
        rerender(
            player(
                { ...recording, id: "third-recording" },
                "Speaker 1: Plain text",
            ),
        );
        expect(
            screen.queryByRole("switch", { name: "Follow playback" }),
        ).toBeNull();
        expect(screen.queryByRole("button", { name: /Plain text/ })).toBeNull();
        expect(audio.currentTime).toBe(0);
    });
});
