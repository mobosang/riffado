"use client";

import { Pencil, Plus, Speech, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getApiErrorMessage } from "@/lib/api-errors";
import { useUiText } from "@/lib/i18n/client";
import {
    CAMPPLUS_MODEL,
    MAX_LIBRARY_BYTES,
    type VoiceprintProvider,
} from "@/lib/voiceprints/format";

const ENDPOINT = "/api/settings/ai/voiceprints";
const CAMPLUS_PROVIDER = {
    name: "Nemotron 3 Diarization + CAM++",
    endpoint: "http://voiceprints:9021/embed",
    model: CAMPPLUS_MODEL,
};

interface VoiceprintSettingsData {
    provider: VoiceprintProvider | null;
    diarizationAvailable: boolean;
    profiles: { id: string; name: string; sampleCount: number }[];
}

export function VoiceprintSettings() {
    const uiText = useUiText();
    const confirm = useConfirm();
    const fieldId = useId();
    const [data, setData] = useState<VoiceprintSettingsData>();
    const [draft, setDraft] = useState<VoiceprintProvider | null>(null);
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState(false);
    const load = useCallback(async (signal?: AbortSignal) => {
        try {
            const response = await fetch(ENDPOINT, { signal });
            if (!response.ok) throw new Error();
            const result: VoiceprintSettingsData = await response.json();
            if (!result || !Array.isArray(result.profiles)) throw new Error();
            if (!signal?.aborted) {
                setData(result);
                setFailed(false);
            }
        } catch {
            if (!signal?.aborted) setFailed(true);
        }
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    async function update(init: RequestInit, path = ENDPOINT) {
        setBusy(true);
        try {
            const response = await fetch(path, init);
            if (!response.ok) {
                toast.error(
                    await getApiErrorMessage(
                        response,
                        "Could not update voiceprint settings.",
                        uiText.locale,
                    ),
                );
                return false;
            }
            await load();
            return true;
        } catch {
            toast.error(uiText("Could not update voiceprint settings."));
            return false;
        } finally {
            setBusy(false);
        }
    }

    async function save(provider: VoiceprintProvider | null) {
        if (
            await update({
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ provider }),
            })
        ) {
            setDraft(null);
        }
    }

    if (failed) {
        return (
            <div className="flex items-center justify-between gap-3 rounded-lg border p-4 text-sm">
                <span>{uiText("Could not load voiceprint settings.")}</span>
                <Button size="sm" variant="outline" onClick={() => void load()}>
                    {uiText("Try again")}
                </Button>
            </div>
        );
    }
    if (!data) return null;

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
                <div className="min-w-0 flex-1">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                        <Speech className="size-4 shrink-0" />
                        {data.provider?.name ??
                            uiText("Voiceprint recognition")}
                        {data.provider && (
                            <span className="rounded border px-2 py-0.5 text-xs font-normal text-muted-foreground">
                                {uiText("Voiceprint recognition")}
                            </span>
                        )}
                    </h3>
                    {data.provider ? (
                        <>
                            <p className="truncate text-sm text-muted-foreground">
                                {data.provider.model}
                            </p>
                            <p className="truncate font-mono text-xs text-muted-foreground">
                                {data.provider.endpoint}
                            </p>
                        </>
                    ) : (
                        <p className="mt-1 text-sm text-muted-foreground">
                            {uiText(
                                "Recognize people you have enrolled across recordings.",
                            )}
                        </p>
                    )}
                </div>
                {data.provider ? (
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="icon"
                            disabled={busy}
                            aria-label={uiText("Edit voiceprint service")}
                            onClick={() => setDraft(data.provider)}
                        >
                            <Pencil className="size-4" />
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            disabled={busy}
                            aria-label={uiText("Remove voiceprint service")}
                            onClick={() =>
                                void confirm({
                                    title: uiText("Remove voiceprint service?"),
                                    description: uiText(
                                        "Your enrolled voiceprints will remain in the library.",
                                    ),
                                    confirmLabel: uiText("Remove"),
                                    destructive: true,
                                    onConfirm: async () => {
                                        await save(null);
                                    },
                                })
                            }
                        >
                            <Trash2 className="size-4" />
                        </Button>
                    </div>
                ) : (
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDraft(CAMPLUS_PROVIDER)}
                    >
                        <Plus className="size-4" />
                        {uiText("Add voiceprint service")}
                    </Button>
                )}
            </div>
            <details className="rounded-lg border p-4 text-sm">
                <summary className="cursor-pointer font-medium">
                    {uiText("Voiceprint library")}
                </summary>
                {!data.profiles.length && (
                    <p className="mt-3 text-muted-foreground">
                        {uiText(
                            "Open a recording and use Generate voiceprints to enroll someone.",
                        )}
                    </p>
                )}
                {data.profiles.map(({ id, name, sampleCount }) => (
                    <div
                        key={id}
                        className="mt-3 flex items-center justify-between gap-3"
                    >
                        <div className="min-w-0">
                            <div dir="auto" className="wrap-break-word">
                                {name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                                {uiText("{count} voice samples", {
                                    count: sampleCount,
                                })}
                            </div>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            disabled={busy}
                            aria-label={uiText("Delete voiceprint")}
                            onClick={() =>
                                void confirm({
                                    title: uiText(
                                        "Delete this person's voiceprints?",
                                    ),
                                    description: uiText(
                                        "They will need to be enrolled again for future matches.",
                                    ),
                                    confirmLabel: uiText("Delete"),
                                    destructive: true,
                                    onConfirm: async () => {
                                        await update(
                                            { method: "DELETE" },
                                            `${ENDPOINT}?id=${encodeURIComponent(id)}`,
                                        );
                                    },
                                })
                            }
                        >
                            <Trash2 className="size-4" />
                        </Button>
                    </div>
                ))}
                <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" asChild>
                        <a
                            href={`${ENDPOINT}?export=1`}
                            download="voiceprints.json"
                        >
                            {uiText("Export voiceprints")}
                        </a>
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                        <label className="cursor-pointer">
                            {uiText("Import voiceprints")}
                            <input
                                type="file"
                                accept=".json,application/json"
                                className="sr-only"
                                disabled={busy}
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    event.target.value = "";
                                    if (!file) return;
                                    if (file.size > MAX_LIBRARY_BYTES) {
                                        toast.error(
                                            uiText(
                                                "Invalid or oversized voiceprint library file.",
                                            ),
                                        );
                                        return;
                                    }
                                    void update({
                                        method: "POST",
                                        headers: {
                                            "Content-Type": "application/json",
                                        },
                                        body: file,
                                    });
                                }}
                            />
                        </label>
                    </Button>
                </div>
            </details>
            <Dialog
                open={draft !== null}
                onOpenChange={(open) => {
                    if (!open && !busy) setDraft(null);
                }}
            >
                {draft && (
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>
                                {uiText(
                                    data.provider
                                        ? "Edit voiceprint service"
                                        : "Add voiceprint service",
                                )}
                            </DialogTitle>
                            <DialogDescription>
                                {uiText(
                                    "Use a compatible voiceprint endpoint. Nemotron 3 Diarization separates speakers, and CAM++ extracts the voiceprints.",
                                )}
                            </DialogDescription>
                        </DialogHeader>
                        {!data.diarizationAvailable && (
                            <p className="text-sm text-destructive">
                                {uiText(
                                    "Configure a local diarization service first.",
                                )}
                            </p>
                        )}
                        <form
                            className="space-y-4"
                            onSubmit={(event) => {
                                event.preventDefault();
                                void save(draft);
                            }}
                        >
                            <label
                                className="block space-y-1 text-sm"
                                htmlFor={`${fieldId}-name`}
                            >
                                <span>{uiText("Service name")}</span>
                                <Input
                                    id={`${fieldId}-name`}
                                    value={draft.name}
                                    required
                                    maxLength={80}
                                    onChange={(event) =>
                                        setDraft({
                                            ...draft,
                                            name: event.target.value,
                                        })
                                    }
                                />
                            </label>
                            <label
                                className="block space-y-1 text-sm"
                                htmlFor={`${fieldId}-endpoint`}
                            >
                                <span>{uiText("Voiceprint endpoint")}</span>
                                <Input
                                    id={`${fieldId}-endpoint`}
                                    value={draft.endpoint}
                                    type="url"
                                    required
                                    maxLength={512}
                                    onChange={(event) =>
                                        setDraft({
                                            ...draft,
                                            endpoint: event.target.value,
                                        })
                                    }
                                />
                            </label>
                            <label
                                className="block space-y-1 text-sm"
                                htmlFor={`${fieldId}-model`}
                            >
                                <span>{uiText("Voiceprint model ID")}</span>
                                <Input
                                    id={`${fieldId}-model`}
                                    value={draft.model}
                                    required
                                    maxLength={128}
                                    onChange={(event) =>
                                        setDraft({
                                            ...draft,
                                            model: event.target.value,
                                        })
                                    }
                                />
                            </label>
                            <Button type="submit" disabled={busy}>
                                {uiText(busy ? "Saving…" : "Save")}
                            </Button>
                        </form>
                    </DialogContent>
                )}
            </Dialog>
        </div>
    );
}
