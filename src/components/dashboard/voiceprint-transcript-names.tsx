"use client";

import { Loader2, Play, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getApiErrorMessage } from "@/lib/api-errors";
import { useUiText } from "@/lib/i18n/client";
import { recordingAudioPlaybackPath } from "@/lib/recordings/filename";
import type { RecordingVoiceprints } from "@/lib/voiceprints/format";
import type {
    TranscriptNameEditor,
    TranscriptSpeaker,
} from "@/lib/voiceprints/transcript";

interface EditorResponse {
    saved: RecordingVoiceprints["saved"];
    transcript: TranscriptNameEditor | null;
}

export function VoiceprintTranscriptNames({
    endpoint,
    recordingId,
    onBack,
    onApplied,
}: {
    endpoint: string;
    recordingId: string;
    onBack: () => void;
    onApplied: () => void;
}) {
    const uiText = useUiText();
    const { refresh } = useRouter();
    const [editor, setEditor] = useState<EditorResponse | null>(null);
    const [selections, setSelections] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [applying, setApplying] = useState(false);
    const [stale, setStale] = useState(false);
    const [error, setError] = useState("");
    const [previewSpeaker, setPreviewSpeaker] = useState<string | null>(null);
    const [previewError, setPreviewError] = useState(false);
    const previewAudio = useRef<HTMLAudioElement | null>(null);
    const request = useRef<AbortController | null>(null);

    const releaseAudio = useCallback(() => {
        const audio = previewAudio.current;
        if (!audio) return;
        previewAudio.current = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
    }, []);

    function listen({ speaker, preview }: TranscriptSpeaker) {
        if (!preview) return;
        releaseAudio();
        setPreviewError(false);
        if (previewSpeaker === speaker) {
            setPreviewSpeaker(null);
            return;
        }

        const url = recordingAudioPlaybackPath(
            encodeURIComponent(recordingId),
            {
                stream: true,
            },
        );
        const { start, end } = preview;
        const audio = new Audio(`${url}#t=${start},${end}`);
        previewAudio.current = audio;
        setPreviewSpeaker(speaker);

        function finish(failed = false) {
            if (previewAudio.current !== audio) return;
            releaseAudio();
            setPreviewSpeaker(null);
            setPreviewError(failed);
        }

        audio.onloadedmetadata = () => {
            if (Number.isFinite(audio.duration) && start >= audio.duration) {
                finish(true);
            } else if (audio.currentTime < start) {
                audio.currentTime = start;
            }
        };
        audio.ontimeupdate = () => {
            if (!audio.seeking && audio.currentTime >= end) finish();
        };
        audio.onpause = () => finish();
        audio.onended = () => finish();
        audio.onerror = () => finish(true);
        audio.currentTime = start;
        void audio.play().catch(() => finish(true));
    }

    const load = useCallback(async () => {
        request.current?.abort();
        releaseAudio();
        setPreviewSpeaker(null);
        setPreviewError(false);
        const controller = new AbortController();
        request.current = controller;
        setLoading(true);
        setError("");
        try {
            const response = await fetch(`${endpoint}?transcript=1`, {
                cache: "no-store",
                signal: controller.signal,
            });
            if (!response.ok) {
                const message = await getApiErrorMessage(
                    response,
                    "Could not load the speaker list.",
                );
                if (!controller.signal.aborted) setError(message);
                return;
            }
            const result = (await response.json()) as EditorResponse;
            if (controller.signal.aborted) return;
            setEditor(result);
            setSelections(
                Object.fromEntries(
                    (result.transcript?.speakers ?? []).map((speaker) => [
                        speaker.speaker,
                        speaker.suggestedProfileId ?? "",
                    ]),
                ),
            );
            setStale(false);
        } catch {
            if (!controller.signal.aborted)
                setError("Could not load the speaker list.");
        } finally {
            if (!controller.signal.aborted) setLoading(false);
        }
    }, [endpoint, releaseAudio]);
    useEffect(() => {
        void load();
        return () => {
            request.current?.abort();
            releaseAudio();
        };
    }, [load, releaseAudio]);

    const assignments = Object.entries(selections)
        .filter(([, id]) => id)
        .map(([speaker, profileId]) => ({ speaker, profileId }));
    const revision = editor?.transcript?.revision;

    async function apply() {
        if (!revision || !assignments.length || loading || stale || applying)
            return;
        setApplying(true);
        setError("");
        try {
            const response = await fetch(endpoint, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ revision, assignments }),
            });
            if (!response.ok) {
                if (response.status === 409) setStale(true);
                setError(
                    await getApiErrorMessage(
                        response,
                        "Could not apply speaker names.",
                    ),
                );
                return;
            }
            toast.success(
                uiText("Names applied to your provider's transcript."),
            );
            onApplied();
            refresh();
        } catch {
            setError("Could not apply speaker names.");
        } finally {
            setApplying(false);
        }
    }

    if (loading) {
        return (
            <output className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                {uiText("Loading speaker list…")}
            </output>
        );
    }

    return (
        <form
            className="space-y-4"
            onSubmit={(event) => {
                event.preventDefault();
                void apply();
            }}
        >
            {editor?.transcript?.speakers.length && editor.saved.length ? (
                <ul className="divide-y rounded-md border px-3">
                    {editor.transcript.speakers.map((speaker) => (
                        <li key={speaker.speaker} className="py-3">
                            <label className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
                                <span>{speaker.speaker}</span>
                                <select
                                    dir="auto"
                                    aria-label={speaker.speaker}
                                    className="h-8 max-w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                                    disabled={stale || applying}
                                    value={selections[speaker.speaker] ?? ""}
                                    onChange={(event) => {
                                        const chosen =
                                            event.currentTarget.value;
                                        setSelections((current) => ({
                                            ...current,
                                            [speaker.speaker]: chosen,
                                        }));
                                    }}
                                >
                                    <option value="">
                                        {speaker.name
                                            ? uiText("Keep {name}", {
                                                  name: speaker.name,
                                              })
                                            : uiText("Keep the speaker number")}
                                    </option>
                                    {editor.saved.map(({ id, name }) => (
                                        <option key={id} value={id}>
                                            {name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <div className="mt-1 flex items-center gap-2">
                                <p
                                    dir="auto"
                                    className="min-w-0 flex-1 line-clamp-2 text-xs text-muted-foreground"
                                >
                                    <span
                                        dir="ltr"
                                        className="me-2 tabular-nums"
                                    >
                                        {speaker.timestamp}
                                    </span>
                                    {speaker.excerpt}
                                </p>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="shrink-0"
                                    disabled={!speaker.preview}
                                    aria-label={uiText(
                                        previewSpeaker === speaker.speaker
                                            ? "Stop audio preview for {speaker}"
                                            : "Play original audio for {speaker}",
                                        { speaker: speaker.speaker },
                                    )}
                                    title={
                                        !speaker.preview
                                            ? uiText(
                                                  "Audio preview unavailable for this timestamp.",
                                              )
                                            : speaker.preview.sharedTimestamp
                                              ? uiText(
                                                    "Multiple turns share this timestamp.",
                                                )
                                              : undefined
                                    }
                                    onClick={() => listen(speaker)}
                                >
                                    {previewSpeaker === speaker.speaker ? (
                                        <Square
                                            aria-hidden="true"
                                            className="size-3"
                                        />
                                    ) : (
                                        <Play
                                            aria-hidden="true"
                                            className="size-3"
                                        />
                                    )}
                                    {uiText(
                                        previewSpeaker === speaker.speaker
                                            ? "Stop preview"
                                            : "Play original audio",
                                    )}
                                </Button>
                            </div>
                        </li>
                    ))}
                </ul>
            ) : editor ? (
                <p className="text-sm text-muted-foreground">
                    {uiText(
                        "Applying names requires saved voiceprints and timed speaker labels in your provider's transcript.",
                    )}
                </p>
            ) : null}
            {previewError && (
                <p role="alert" className="text-sm text-destructive">
                    {uiText("Failed to play audio")}
                </p>
            )}
            {error && (
                <p role="alert" className="text-sm text-destructive">
                    {uiText(error)}
                </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={applying}
                    onClick={onBack}
                >
                    {uiText("Back")}
                </Button>
                {stale || !editor ? (
                    <Button type="button" size="sm" onClick={() => void load()}>
                        {uiText("Reload speaker list")}
                    </Button>
                ) : (
                    <Button
                        type="submit"
                        size="sm"
                        disabled={!assignments.length || applying}
                    >
                        {uiText(applying ? "Saving…" : "Apply names")}
                    </Button>
                )}
            </div>
        </form>
    );
}
