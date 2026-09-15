// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageSelect } from "@/components/language-select";
import { buildSettingsNav } from "@/components/settings-nav-config";
import { DisplaySection } from "@/components/settings-sections/display-section";
import { useAutoSync } from "@/hooks/use-auto-sync";
import { UI_LOCALE_COOKIE } from "@/lib/i18n";
import { UiLocaleProvider, useUiText } from "@/lib/i18n/client";
import { getUiPresets } from "@/lib/i18n/presets";

const { refresh, loaded, router } = vi.hoisted(() => {
    const refresh = vi.fn();
    return { refresh, loaded: vi.fn(), router: { refresh } };
});
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/hooks/use-settings", () => ({
    useSettings: () => ({
        isLoadingSettings: false,
        isSavingSettings: false,
        setIsLoadingSettings: loaded,
    }),
}));

afterEach(() => {
    cleanup();
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom exposes document.cookie for preference cleanup.
    document.cookie = `${UI_LOCALE_COOKIE}=; Path=/; Max-Age=0`;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    localStorage.clear();
});

function Labels() {
    const uiText = useUiText();
    return createElement(
        "output",
        null,
        uiText("Settings"),
        " / ",
        buildSettingsNav({ isHosted: false, locale: uiText.locale }).find(
            (item) => item.id === "display",
        )?.name,
        " / ",
        getUiPresets(uiText.locale).UI_TITLE_PRESETS.default.name,
    );
}

function SyncProbe() {
    useAutoSync({ minInterval: 0, syncOnVisibilityChange: false });
    return <LanguageSelect />;
}

describe("UI language preference", () => {
    it("does not restart automatic synchronization when only the language changes", async () => {
        const fetchMock = vi
            .fn()
            .mockImplementation(
                async () =>
                    new Response('{"newRecordings":0}', { status: 200 }),
            );
        vi.stubGlobal("fetch", fetchMock);
        await act(async () => {
            render(
                <UiLocaleProvider initialLocale="en">
                    <SyncProbe />
                </UiLocaleProvider>,
            );
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await act(async () => {
            fireEvent.change(screen.getByLabelText("Interface language"), {
                target: { value: "zh-CN" },
            });
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it("switches the display settings and preset labels in both directions without saving AI settings", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(new Response("{}", { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        await act(async () => {
            render(
                <UiLocaleProvider initialLocale="en">
                    <DisplaySection />
                    <Labels />
                </UiLocaleProvider>,
            );
        });
        expect(
            screen.getByLabelText("Interface language").getAttribute("id"),
        ).toBeTruthy();
        expect(screen.getByText("Settings / Display / Default")).toBeTruthy();
        fireEvent.change(screen.getByLabelText("Interface language"), {
            target: { value: "zh-CN" },
        });
        expect(screen.getByLabelText("界面语言")).toBeTruthy();
        expect(screen.getByText("设置 / 显示 / 默认")).toBeTruthy();
        expect(document.cookie).toContain(`${UI_LOCALE_COOKIE}=zh-CN`);
        expect(document.documentElement.lang).toBe("zh-CN");
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(
            fetchMock.mock.calls.every(
                (call) => !call[1]?.method || call[1].method === "GET",
            ),
        ).toBe(true);
        fireEvent.change(screen.getByLabelText("界面语言"), {
            target: { value: "en" },
        });
        expect(screen.getByText("Settings / Display / Default")).toBeTruthy();
        expect(document.cookie).toContain(`${UI_LOCALE_COOKIE}=en`);
    });

    it("hydrates the saved Chinese locale without a server/client text mismatch", async () => {
        const element = (
            <UiLocaleProvider initialLocale="zh-CN">
                <LanguageSelect />
                <Labels />
            </UiLocaleProvider>
        );
        const html = renderToString(element);
        expect(html).toContain("界面语言");
        const container = document.createElement("div");
        container.innerHTML = html;
        document.body.append(container);
        const errors = vi.fn();
        let root: ReturnType<typeof hydrateRoot>;
        await act(async () => {
            root = hydrateRoot(container, element, {
                onRecoverableError: errors,
            });
        });
        expect(errors).not.toHaveBeenCalled();
        expect(container.textContent).toContain("设置 / 显示 / 默认");
        await act(async () => root.unmount());
        container.remove();
    });

    it("does not share the selected locale between independent providers", () => {
        render(
            createElement(
                "div",
                null,
                <UiLocaleProvider initialLocale="en">
                    <Labels />
                </UiLocaleProvider>,
                <UiLocaleProvider initialLocale="zh-CN">
                    <Labels />
                </UiLocaleProvider>,
            ),
        );
        expect(screen.getByText("Settings / Display / Default")).toBeTruthy();
        expect(screen.getByText("设置 / 显示 / 默认")).toBeTruthy();
    });
});
