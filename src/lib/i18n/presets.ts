import { PROMPT_PRESETS } from "@/lib/ai/prompt-presets";
import { AI_OUTPUT_LANGUAGES, SUMMARY_PRESETS } from "@/lib/ai/summary-presets";
import { createUiText, type UiLocale, type UiTranslator } from "@/lib/i18n";

function displayPresets<
    T extends Record<string, { name: string; description: string }>,
>(presets: T, uiText: UiTranslator): T {
    return Object.fromEntries(
        Object.entries(presets).map(([id, preset]) => [
            id,
            {
                ...preset,
                name: uiText(preset.name),
                description: uiText(preset.description),
            },
        ]),
    ) as T;
}

function localizePresets(locale: UiLocale) {
    const uiText = createUiText(locale);
    return {
        UI_TITLE_PRESETS: displayPresets(PROMPT_PRESETS, uiText),
        UI_SUMMARY_PRESETS: displayPresets(SUMMARY_PRESETS, uiText),
        UI_OUTPUT_LANGUAGES: AI_OUTPUT_LANGUAGES.map((language) => ({
            ...language,
            label: uiText(language.label),
        })),
    };
}

const presetsByLocale = {
    en: localizePresets("en"),
    "zh-CN": localizePresets("zh-CN"),
};

/** Return stable display-only presets for the selected language. */
export function getUiPresets(locale: UiLocale) {
    return presetsByLocale[locale];
}
