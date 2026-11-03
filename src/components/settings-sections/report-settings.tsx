"use client";
import { useEffect, useState } from "react";
import { SUMMARY_PRESETS } from "@/lib/ai/summary-presets";
import { useUiText } from "@/lib/i18n/client";
export function ReportSettings() {
    const t = useUiText();
    const [preset, setPreset] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(false);
    useEffect(() => {
        const abort = new AbortController();
        fetch("/api/settings/user", { signal: abort.signal })
            .then(async (r) => {
                if (!r.ok) throw Error();
                const data = await r.json();
                if (!abort.signal.aborted)
                    setPreset(data.reportPreset ?? "meeting-notes");
            })
            .catch(() => {
                if (!abort.signal.aborted) setError(true);
            });
        return () => abort.abort();
    }, []);
    async function select(id: string) {
        setSaving(true);
        setError(false);
        try {
            const r = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reportPreset: id }),
            });
            if (!r.ok) throw Error();
            setPreset(id);
        } catch {
            setError(true);
        } finally {
            setSaving(false);
        }
    }
    return (
        <fieldset disabled={!preset || saving} className="grid gap-3">
            <legend className="mb-3 text-lg font-semibold">
                {t("Report template")}
            </legend>
            {Object.values(SUMMARY_PRESETS).map((p) => (
                <label key={p.id} className="flex gap-3 rounded-lg border p-4">
                    <input
                        type="radio"
                        name="report-template"
                        checked={p.id === preset}
                        onChange={() => select(p.id)}
                    />
                    <span>
                        <strong>{t(p.name)}</strong>
                        <span className="block text-sm text-muted-foreground">
                            {t(p.description)}
                        </span>
                    </span>
                </label>
            ))}
            {error && <p role="alert">{t("Report settings unavailable.")}</p>}
        </fieldset>
    );
}
