"use client";
import { useEffect, useState } from "react";
import { REPORT_PRESETS } from "@/lib/ai/report-presets";
import { NO_VISUALS, type VisualOptions } from "@/lib/ai/report-visuals";
import { useUiText } from "@/lib/i18n/client";
export function ReportSettings() {
    const t = useUiText();
    const [preset, setPreset] = useState("");
    const [visuals, setVisuals] = useState<Record<string, VisualOptions>>({});
    const selected = visuals[preset] ?? NO_VISUALS;
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(false);
    useEffect(() => {
        const abort = new AbortController();
        fetch("/api/settings/user", { signal: abort.signal })
            .then(async (r) => {
                if (!r.ok) throw Error();
                const data = await r.json();
                if (!abort.signal.aborted) {
                    setPreset(data.reportPreset ?? "meeting-notes");
                    setVisuals(data.reportVisuals ?? {});
                }
            })
            .catch(() => {
                if (!abort.signal.aborted) setError(true);
            });
        return () => abort.abort();
    }, []);
    async function select(id: string, options?: VisualOptions) {
        setSaving(true);
        setError(false);
        try {
            const r = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    reportPreset: id,
                    reportVisualOptions: options,
                }),
            });
            if (!r.ok) throw Error();
            setPreset(id);
            if (options) setVisuals((prev) => ({ ...prev, [id]: options }));
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
            {Object.values(REPORT_PRESETS).map((p) => (
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
            <fieldset disabled={!preset || saving} className="grid gap-2">
                <legend>{t("Images for this template")}</legend>
                <label>
                    <input
                        type="checkbox"
                        checked={selected.mindMap}
                        onChange={(e) =>
                            select(preset, {
                                ...selected,
                                mindMap: e.target.checked,
                            })
                        }
                    />{" "}
                    {t("Mind map")}
                </label>
                <label>
                    <input
                        type="checkbox"
                        checked={selected.tagChart}
                        onChange={(e) =>
                            select(preset, {
                                ...selected,
                                tagChart: e.target.checked,
                            })
                        }
                    />{" "}
                    {t("Report brief")}
                </label>
            </fieldset>
        </fieldset>
    );
}
