"use client";

import { useId } from "react";
import { normalizeUiLocale } from "@/lib/i18n";
import { useUiLocale, useUiText } from "@/lib/i18n/client";

/** Select a UI language without changing transcription or AI output settings. */
export function LanguageSelect() {
    const id = useId();
    const { locale, setLocale } = useUiLocale();
    const uiText = useUiText();
    return (
        <div className="space-y-2">
            <label htmlFor={id} className="text-sm font-medium">
                {uiText("Interface language")}
            </label>
            <select
                id={id}
                value={locale}
                onKeyDown={(event) => event.stopPropagation()}
                onChange={(event) =>
                    setLocale(normalizeUiLocale(event.target.value))
                }
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
                <option value="en" lang="en">
                    English
                </option>
                <option value="zh-CN" lang="zh-CN">
                    简体中文
                </option>
            </select>
            <p className="text-xs text-muted-foreground">
                {uiText(
                    "Saved in this browser. Does not change the language of your transcripts or AI output.",
                )}
            </p>
        </div>
    );
}
