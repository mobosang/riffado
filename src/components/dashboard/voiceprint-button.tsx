"use client";

import { Loader2, Speech } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { VoiceprintTranscriptNames } from "@/components/dashboard/voiceprint-transcript-names";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getApiErrorMessage } from "@/lib/api-errors";
import { formatDuration } from "@/lib/format-duration";
import { useUiText } from "@/lib/i18n/client";
import type {
    RecordingVoiceprints,
    VoiceprintCandidate,
} from "@/lib/voiceprints/format";

const EMPTY_VOICEPRINTS: RecordingVoiceprints = { saved: [], candidates: [] };

export function VoiceprintButton({
    recordingId,
    onOpen,
}: {
    recordingId: string;
    onOpen?: () => void;
}) {
    const uiText = useUiText();
    const [open, setOpen] = useState(false);
    const [editingTranscript, setEditingTranscript] = useState(false);
    const [pending, setPending] = useState<"load" | "extract" | null>(null);
    const [error, setError] = useState("");
    const [{ saved, candidates }, setVoiceprints] = useState(EMPTY_VOICEPRINTS);
    const request = useRef<AbortController | null>(null);
    const previewAudio = useRef<HTMLAudioElement | null>(null);
    const endpoint = `/api/recordings/${encodeURIComponent(recordingId)}/voiceprints`;
    useEffect(() => () => request.current?.abort(), []);

    function handleOpenChange(next: boolean) {
        setOpen(next);
        if (next) {
            onOpen?.();
            void load();
        } else {
            request.current?.abort();
            previewAudio.current?.pause();
            previewAudio.current = null;
            setVoiceprints(EMPTY_VOICEPRINTS);
            setEditingTranscript(false);
        }
    }

    async function load(regenerate = false) {
        request.current?.abort();
        const current = new AbortController();
        request.current = current;
        setPending(regenerate ? "extract" : "load");
        setError("");
        setVoiceprints(({ saved }) => ({ saved, candidates: [] }));

        async function read(url: string, method: "GET" | "POST") {
            const response = await fetch(url, {
                method,
                signal: current.signal,
                cache: "no-store",
            });
            if (!response.ok) {
                const fallback =
                    method === "GET"
                        ? "Could not load voiceprints."
                        : "Could not generate voiceprints.";
                throw new Error(
                    await getApiErrorMessage(response, fallback, uiText.locale),
                );
            }
            return (await response.json()) as RecordingVoiceprints;
        }

        try {
            let result = regenerate
                ? await read(`${endpoint}?regenerate=1`, "POST")
                : await read(endpoint, "GET");
            if (current.signal.aborted) return;
            if (!regenerate && !result.saved.length) {
                setPending("extract");
                result = await read(endpoint, "POST");
            }
            if (!current.signal.aborted) setVoiceprints(result);
        } catch (failure) {
            if (!current.signal.aborted)
                setError(
                    failure instanceof Error && !/fetch/i.test(failure.message)
                        ? failure.message
                        : uiText("Could not load voiceprints."),
                );
        } finally {
            if (!current.signal.aborted) setPending(null);
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <button
                    type="button"
                    className="inline-flex items-center gap-1 underline-offset-2 hover:text-foreground hover:underline"
                >
                    <span aria-hidden="true" className="opacity-40">
                        ·
                    </span>
                    <Speech aria-hidden="true" className="size-3" />
                    {uiText("Voiceprints")}
                </button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        {uiText(
                            editingTranscript
                                ? "Apply names to this transcript"
                                : "Voiceprints",
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {uiText(
                            editingTranscript
                                ? "Review the names suggested from sample times or choose a saved name."
                                : "View saved voiceprints or listen to extracted samples and save them under a speaker's name.",
                        )}
                    </DialogDescription>
                </DialogHeader>
                {saved.length > 0 && !editingTranscript && (
                    <section className="space-y-2 rounded-md border p-3">
                        <h3 className="text-sm font-medium">
                            {uiText("Saved voiceprints")}
                        </h3>
                        <ul className="space-y-1 text-sm">
                            {saved.map(({ id, name, sampleCount }) => (
                                <li
                                    key={id}
                                    className="flex flex-wrap justify-between gap-2"
                                >
                                    <span
                                        dir="auto"
                                        className="wrap-break-word"
                                    >
                                        {name}
                                    </span>
                                    <span className="text-muted-foreground">
                                        {uiText("{count} voice samples", {
                                            count: sampleCount,
                                        })}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        <Button
                            type="button"
                            size="sm"
                            disabled={Boolean(pending)}
                            onClick={() => {
                                previewAudio.current?.pause();
                                setEditingTranscript(true);
                            }}
                        >
                            {uiText("Apply names to this transcript")}
                        </Button>
                    </section>
                )}
                {editingTranscript ? (
                    <VoiceprintTranscriptNames
                        endpoint={endpoint}
                        onBack={() => setEditingTranscript(false)}
                        onApplied={() => handleOpenChange(false)}
                    />
                ) : pending ? (
                    <output className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        {uiText(
                            pending === "load"
                                ? "Loading voiceprints…"
                                : "Separating speakers and extracting voiceprints…",
                        )}
                    </output>
                ) : error ? (
                    <div className="space-y-3">
                        <p role="alert" className="text-sm text-destructive">
                            {error}
                        </p>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void load(saved.length > 0)}
                        >
                            {uiText("Try again")}
                        </Button>
                    </div>
                ) : candidates.length ? (
                    <div className="space-y-3">
                        {candidates.map((candidate) => (
                            <VoiceprintEnrollment
                                key={candidate.speaker}
                                candidate={candidate}
                                endpoint={endpoint}
                                onSaved={(saved) =>
                                    setVoiceprints((current) => ({
                                        ...current,
                                        saved,
                                    }))
                                }
                                onPlay={(audio) => {
                                    if (previewAudio.current !== audio)
                                        previewAudio.current?.pause();
                                    previewAudio.current = audio;
                                }}
                            />
                        ))}
                    </div>
                ) : saved.length ? (
                    <Button
                        size="sm"
                        variant="outline"
                        className="justify-self-start"
                        onClick={() => void load(true)}
                    >
                        {uiText("Extract voiceprints again")}
                    </Button>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {uiText(
                            "No clear samples of at least 3 seconds were found in this recording.",
                        )}
                    </p>
                )}
            </DialogContent>
        </Dialog>
    );
}

function VoiceprintEnrollment({
    candidate,
    endpoint,
    onSaved,
    onPlay,
}: {
    candidate: VoiceprintCandidate;
    endpoint: string;
    onSaved: (saved: RecordingVoiceprints["saved"]) => void;
    onPlay: (audio: HTMLAudioElement) => void;
}) {
    const uiText = useUiText();
    const [name, setName] = useState(candidate.name ?? "");
    const [pending, setPending] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState("");

    async function enroll() {
        setPending(true);
        setError("");
        try {
            const response = await fetch(endpoint, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim(),
                    proof: candidate.proof,
                }),
            });
            if (response.ok) {
                const result: Pick<RecordingVoiceprints, "saved"> =
                    await response.json();
                onSaved(result.saved);
                setSaved(true);
            } else {
                setError(
                    await getApiErrorMessage(
                        response,
                        "Could not save voiceprints.",
                        uiText.locale,
                    ),
                );
            }
        } catch {
            setError(uiText("Could not save voiceprints."));
        } finally {
            setPending(false);
        }
    }

    return (
        <section className="space-y-3 rounded-md border p-3">
            <h3 className="font-medium">{candidate.speaker}</h3>
            {candidate.clips.map((clip) => (
                <div key={clip.start} className="space-y-1">
                    <p
                        dir="auto"
                        className="line-clamp-2 text-sm text-muted-foreground"
                    >
                        <span dir="ltr" className="mr-2 tabular-nums">
                            {formatDuration(clip.start)}
                        </span>
                        {clip.text}
                    </p>
                    <audio
                        controls
                        preload="none"
                        className="w-full"
                        src={`data:audio/wav;base64,${clip.preview}`}
                        aria-label={uiText("Play voice sample")}
                        onPlay={(event) => onPlay(event.currentTarget)}
                    >
                        <track kind="captions" />
                    </audio>
                </div>
            ))}
            <form
                className="flex flex-wrap gap-2"
                onSubmit={(event) => {
                    event.preventDefault();
                    void enroll();
                }}
            >
                <Input
                    className="min-w-40 flex-1"
                    dir="auto"
                    value={name}
                    disabled={saved || pending}
                    required
                    maxLength={60}
                    aria-label={uiText("Speaker name")}
                    placeholder={uiText("Speaker name")}
                    onChange={(event) => setName(event.target.value)}
                />
                <Button
                    type="submit"
                    size="sm"
                    disabled={saved || pending || !name.trim()}
                >
                    {uiText(
                        saved
                            ? "Saved"
                            : pending
                              ? "Saving…"
                              : "Save voiceprints",
                    )}
                </Button>
                {error && (
                    <p role="alert" className="w-full text-sm text-destructive">
                        {error}
                    </p>
                )}
            </form>
        </section>
    );
}
