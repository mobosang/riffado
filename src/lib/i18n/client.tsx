"use client";

import { useRouter } from "next/navigation";
import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import {
    createUiText,
    DEFAULT_UI_LOCALE,
    normalizeUiLocale,
    UI_LOCALE_COOKIE,
    type UiLocale,
} from "@/lib/i18n";

const LocaleContext = createContext({
    locale: DEFAULT_UI_LOCALE,
    setLocale: (_locale: UiLocale) => {},
});

/** Keep browser and server-rendered translations on the same explicit locale. */
export function UiLocaleProvider({
    initialLocale,
    children,
}: {
    initialLocale: UiLocale;
    children: ReactNode;
}) {
    const router = useRouter();
    const [locale, updateLocale] = useState(initialLocale);
    useEffect(() => {
        updateLocale(initialLocale);
    }, [initialLocale]);
    useEffect(() => {
        document.documentElement.lang = locale;
    }, [locale]);
    const setLocale = useCallback(
        (value: UiLocale) => {
            const next = normalizeUiLocale(value);
            // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store requires HTTPS; self-host HTTP deployments also need this preference.
            document.cookie = `${UI_LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
            updateLocale(next);
            router.refresh();
        },
        [router],
    );
    const context = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
    return (
        <LocaleContext.Provider value={context}>
            {children}
        </LocaleContext.Provider>
    );
}

/** Access the current UI language and its browser-scoped preference setter. */
export function useUiLocale() {
    return useContext(LocaleContext);
}

/** Bind translations to the nearest locale provider and subscribe to language changes. */
export function useUiText() {
    const { locale } = useUiLocale();
    return useMemo(() => createUiText(locale), [locale]);
}
