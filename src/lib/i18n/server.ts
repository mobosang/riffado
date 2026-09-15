import { cookies } from "next/headers";
import { createUiText, normalizeUiLocale, UI_LOCALE_COOKIE } from "@/lib/i18n";

/** Read the current request's language preference. */
export async function getUiLocale() {
    return normalizeUiLocale((await cookies()).get(UI_LOCALE_COOKIE)?.value);
}

/** Bind translations to this request, never to a process-wide locale. */
export async function getUiText() {
    return createUiText(await getUiLocale());
}
