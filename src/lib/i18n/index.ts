import messages from "./zh-CN.json";

export type UiLocale = "en" | "zh-CN";
export const DEFAULT_UI_LOCALE: UiLocale = "en";
export const UI_LOCALE_COOKIE = "riffado-ui-locale";
export type UiValues = Readonly<Record<string, string | number>>;
export type UiTranslator = ((source: string, values?: UiValues) => string) & {
    locale: UiLocale;
};

/** Resolve only supported UI locales; missing or invalid values use English. */
export function normalizeUiLocale(value: unknown): UiLocale {
    return value === "zh-CN" ? "zh-CN" : DEFAULT_UI_LOCALE;
}

/** Create a request- or provider-scoped translator without shared mutable state. */
export function createUiText(locale: UiLocale): UiTranslator {
    return Object.assign(
        (source: string, values?: UiValues) => uiText(source, values, locale),
        { locale },
    );
}

/** Translate application-owned UI text, with English fallback and named parameters. */
export function uiText(
    source: string,
    values: UiValues = {},
    locale: UiLocale = DEFAULT_UI_LOCALE,
): string {
    const template =
        locale === "zh-CN" && Object.hasOwn(messages, source)
            ? messages[source as keyof typeof messages]
            : source;
    return template.replace(
        /\{([A-Za-z][A-Za-z0-9_]*)\}/g,
        (match, name: string) =>
            Object.hasOwn(values, name) ? String(values[name]) : match,
    );
}
