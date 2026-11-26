"use client";

import { Loader2, Speech } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import type { VoiceprintCandidate } from "@/lib/voiceprints/format";

export function VoiceprintButton({
    recordingId,
    onOpen,
}: {
    recordingId: string;
    onOpen?: () => void;
}) {
    const uiText = useUiText();
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");
    const [candidates, setCandidates] = useState<VoiceprintCandidate[]>([]);
    const request = useRef<AbortController | null>(null);
    const previewAudio = useRef<HTMLAudioElement | null>(null);
    const endpoint = `/api/recordings/${encodeURIComponent(recordingId)}/voiceprints`;
    useEffect(() => () => request.current?.abort(), []);

    async function generate() {
        request.current?.abort();
        const current = new AbortController();
        request.current = current;
        setPending(true);
        setError("");
        setCandidates([]);
        try {
            const response = await fetch(endpoint, {
                method: "POST",
                signal: current.signal,
            });
            if (!response.ok)
                throw new Error(
                    await getApiErrorMessage(
                        response,
                        "Could not generate voiceprints.",
                        uiText.locale,
                    ),
                );
            const result: { candidates: VoiceprintCandidate[] } =
                await response.json();
            if (!current.signal.aborted) setCandidates(result.candidates);
        } catch (failure) {
            if (!current.signal.aborted)
                setError(
                    failure instanceof Error && !/fetch/i.test(failure.message)
                        ? failure.message
                        : uiText("Could not generate voiceprints."),
                );
        } finally {
            if (!current.signal.aborted) setPending(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (next) {
                    onOpen?.();
                    void generate();
                } else {
                    request.current?.abort();
                    previewAudio.current?.pause();
                    previewAudio.current = null;
                    setCandidates([]);
                }
            }}
        >
            <DialogTrigger asChild>
                <button
                    type="button"
                    className="inline-flex items-center gap-1 underline-offset-2 hover:text-foreground hover:underline"
                >
                    <span aria-hidden="true" className="opacity-40">
                        ·
                    </span>
                    <Speech aria-hidden="true" className="size-3" />
                    {uiText("Generate voiceprints")}
                </button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{uiText("Generate voiceprints")}</DialogTitle>
                    <DialogDescription>
                        {uiText(
                            "Listen to the samples, then save each person under their name. Future transcriptions can use the name when the voice matches.",
                        )}
                    </DialogDescription>
                </DialogHeader>
                {pending ? (
                    <output className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        {uiText(
                            "Separating speakers and extracting voiceprints…",
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
                            onClick={() => void generate()}
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
                                onPlay={(audio) => {
                                    if (previewAudio.current !== audio)
                                        previewAudio.current?.pause();
                                    previewAudio.current = audio;
                                }}
                            />
                        ))}
                    </div>
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
    onPlay,
}: {
    candidate: VoiceprintCandidate;
    endpoint: string;
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
            if (response.ok) setSaved(true);
            else
                setError(
                    await getApiErrorMessage(
                        response,
                        "Could not save voiceprints.",
                        uiText.locale,
                    ),
                );
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
