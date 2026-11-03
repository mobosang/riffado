"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SUMMARY_PRESETS, type SummaryPreset } from "@/lib/ai/summary-presets";
import { useUiText } from "@/lib/i18n/client";

interface Report {
    summary: string;
    keyPoints: string[];
    actionItems: string[];
    promptId: SummaryPreset;
}
export function ReportCard({
    id,
    canGenerate,
}: {
    id: string;
    canGenerate: boolean;
}) {
    const t = useUiText();
    const [data, setData] = useState<Report | null>(null);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState(false);
    const url = `/api/recordings/${encodeURIComponent(id)}/report`;
    useEffect(() => {
        const abort = new AbortController();
        fetch(url, { signal: abort.signal })
            .then(async (r) => {
                if (!r.ok) throw Error();
                const d = await r.json();
                if (!abort.signal.aborted) setData(d);
            })
            .catch(() => {
                if (!abort.signal.aborted) setError(true);
            })
            .finally(() => {
                if (!abort.signal.aborted) setBusy(false);
            });
        return () => abort.abort();
    }, [url]);
    async function generate() {
        setBusy(true);
        setError(false);
        try {
            const r = await fetch(url, { method: "POST" });
            if (!r.ok) throw Error();
            setData(await r.json());
        } catch {
            setError(true);
        } finally {
            setBusy(false);
        }
    }
    return (
        <Card id="report">
            <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <CardTitle>{t("Recording report")}</CardTitle>
                    <div className="flex items-center gap-3">
                        <Link
                            className="text-sm underline"
                            href="/settings#report"
                        >
                            {t("Report template")}
                        </Link>
                        <Button
                            disabled={busy || !canGenerate}
                            onClick={generate}
                        >
                            {busy
                                ? t("Loading...")
                                : data
                                  ? t("Re-generate")
                                  : t("Generate report")}
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent aria-live="polite">
                {error && (
                    <p role="alert">
                        {t("Report unavailable. Please try again.")}
                    </p>
                )}
                {data ? (
                    <div className="space-y-3">
                        <small>
                            {t(
                                SUMMARY_PRESETS[data.promptId]?.name ??
                                    "Recording report",
                            )}
                        </small>
                        <p className="whitespace-pre-wrap">{data.summary}</p>
                        {[
                            [t("Key Points"), data.keyPoints],
                            [t("Action Items"), data.actionItems],
                        ].map(
                            ([title, items]) =>
                                Array.isArray(items) &&
                                items.length > 0 && (
                                    <div key={String(title)}>
                                        <strong>{title}</strong>
                                        <ul className="list-disc pl-5">
                                            {[...new Set(items)].map((s) => (
                                                <li key={s}>{s}</li>
                                            ))}
                                        </ul>
                                    </div>
                                ),
                        )}
                    </div>
                ) : (
                    !busy && !error && <p>{t("No report yet.")}</p>
                )}
            </CardContent>
        </Card>
    );
}
