"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { REPORT_PRESETS, type ReportPreset } from "@/lib/ai/report-presets";
import type { VisualOptions } from "@/lib/ai/report-visuals";
import { type ApiErrorBody, parseApiError } from "@/lib/api-errors";
import { useUiText } from "@/lib/i18n/client";
import { uiError } from "@/lib/i18n/errors";
import { ReportBrief } from "./report-brief";
import { ReportImage } from "./report-image";

interface Report {
    visuals?: VisualOptions;
    summary: string;
    keyPoints: string[];
    actionItems: string[];
    promptId: ReportPreset;
}
export function ReportCard({
    id,
    title,
    canGenerate,
}: {
    id: string;
    title: string;
    canGenerate: boolean;
}) {
    const t = useUiText();
    const [data, setData] = useState<Report | null>(null);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState<ApiErrorBody | null>(null);
    const url = `/api/recordings/${encodeURIComponent(id)}/report`;
    useEffect(() => {
        const abort = new AbortController();
        setBusy(true);
        setError(null);
        setData(null);
        fetch(url, { signal: abort.signal })
            .then(async (r) => {
                if (!r.ok) {
                    const failure = await parseApiError(r);
                    if (!abort.signal.aborted) setError(failure);
                    return;
                }
                const d = await r.json();
                if (!abort.signal.aborted) setData(d);
            })
            .catch(() => {
                if (!abort.signal.aborted)
                    setError({
                        error: "Report unavailable. Please try again.",
                        code: "NETWORK_ERROR",
                    });
            })
            .finally(() => {
                if (!abort.signal.aborted) setBusy(false);
            });
        return () => abort.abort();
    }, [url]);
    async function generate() {
        setBusy(true);
        setError(null);
        try {
            const r = await fetch(url, { method: "POST" });
            if (!r.ok) {
                const failure = await parseApiError(r);
                setError(failure);
                return;
            }
            setData(await r.json());
        } catch {
            setError({
                error: "Report unavailable. Please try again.",
                code: "NETWORK_ERROR",
            });
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
                        {uiError(error.error, error.code, t.locale)}
                        {typeof error.details?.errorId === "string" &&
                            ` (${error.details.errorId})`}
                    </p>
                )}
                {data ? (
                    <div className="space-y-3">
                        <small>
                            {t(
                                REPORT_PRESETS[data.promptId]?.name ??
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
                        {data.visuals?.mindMap && (
                            <ReportImage
                                title={t("Mind map")}
                                groups={[
                                    {
                                        label: t("Recording report"),
                                        items: [data.summary],
                                    },
                                    {
                                        label: t("Key Points"),
                                        items: data.keyPoints,
                                    },
                                    {
                                        label: t("Action Items"),
                                        items: data.actionItems,
                                    },
                                ]}
                            />
                        )}
                        {data.visuals?.tagChart && (
                            <ReportBrief title={title} report={data} />
                        )}
                    </div>
                ) : (
                    !busy && !error && <p>{t("No report yet.")}</p>
                )}
            </CardContent>
        </Card>
    );
}
