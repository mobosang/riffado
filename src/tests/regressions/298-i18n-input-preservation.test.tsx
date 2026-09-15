// @vitest-environment jsdom
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/auth/login-form";
import { LanguageSelect } from "@/components/language-select";
import { PromptManager } from "@/components/settings-sections/prompt-manager";
import { UI_LOCALE_COOKIE, type UiLocale } from "@/lib/i18n";
import { UiLocaleProvider } from "@/lib/i18n/client";

const { router, signInEmail, loaded } = vi.hoisted(() => ({
    router: { refresh: vi.fn(), push: vi.fn() },
    signInEmail: vi.fn(async () => ({
        error: { message: "Invalid email or password" },
    })),
    loaded: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/auth-client", () => ({ signIn: { email: signInEmail } }));
vi.mock("posthog-js", () => ({ default: { __loaded: false } }));
vi.mock("@/components/confirm-dialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/hooks/use-settings", () => ({
    useSettings: () => ({
        isLoadingSettings: false,
        isSavingSettings: false,
        setIsLoadingSettings: loaded,
    }),
}));

afterEach(() => {
    cleanup();
    // biome-ignore lint/suspicious/noDocumentCookie: Reset the browser preference between tests.
    document.cookie = `${UI_LOCALE_COOKIE}=; Path=/; Max-Age=0`;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
});

describe("PR 298: preserve multilingual input across UI language changes", () => {
    it.each([
        "English draft 123",
        "中文草稿，不要翻译",
        "مسودة عربية لا تترجم",
        "English 中文 العربية {transcription}",
    ])("preserves and submits the exact password: %s", async (value) => {
        const element = (locale: UiLocale) => (
            <UiLocaleProvider initialLocale={locale}>
                <LanguageSelect />
                <LoginForm />
            </UiLocaleProvider>
        );
        const { rerender } = render(element("en"));
        fireEvent.change(screen.getByLabelText("Email"), {
            target: { value: "test@example.com" },
        });
        const password = screen.getByLabelText<HTMLInputElement>("Password");
        fireEvent.change(password, { target: { value } });
        for (const locale of ["zh-CN", "en", "zh-CN"] as const) {
            fireEvent.change(
                screen.getByLabelText(/Interface language|界面语言/),
                { target: { value: locale } },
            );
            rerender(element(locale));
            expect(screen.getByLabelText(/Password|密码/)).toBe(password);
            expect(password.value).toBe(value);
            expect(signInEmail).not.toHaveBeenCalled();
        }
        await act(async () => {
            fireEvent.submit(password.closest("form") as HTMLFormElement);
        });
        expect(signInEmail).toHaveBeenCalledExactlyOnceWith({
            email: "test@example.com",
            password: value,
        });
    });

    it("preserves custom prompt drafts and saves their raw multilingual content", async () => {
        const fetchMock = vi.fn(
            async () => new Response("{}", { status: 200 }),
        );
        vi.stubGlobal("fetch", fetchMock);
        const element = (locale: UiLocale) => (
            <UiLocaleProvider initialLocale={locale}>
                <PromptManager />
            </UiLocaleProvider>
        );
        const { rerender } = render(element("en"));
        await act(async () => {});
        fireEvent.click(screen.getByText("Add Custom Prompt"));
        const name = screen.getByLabelText<HTMLInputElement>("Name");
        const prompt = screen.getByLabelText<HTMLTextAreaElement>("Prompt");
        const title = "Default 中文 العربية";
        const body =
            "English instructions\n中文提示词\nتعليمات عربية\n{transcription}";
        fireEvent.change(name, { target: { value: title } });
        fireEvent.change(prompt, { target: { value: body } });
        for (const locale of ["zh-CN", "en", "zh-CN"] as const) {
            rerender(element(locale));
            expect(document.getElementById("custom-prompt-name")).toBe(name);
            expect(name.value).toBe(title);
            expect(prompt.value).toBe(body);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        }
        rerender(element("en"));
        await act(async () =>
            fireEvent.click(screen.getByRole("button", { name: "Create" })),
        );
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const calls = fetchMock.mock.calls as unknown as [
            string,
            RequestInit?,
        ][];
        const saved = JSON.parse(String(calls[1][1]?.body));
        expect(saved.titleGenerationPrompt.customPrompts[0]).toMatchObject({
            name: title,
            prompt: body,
        });
    });
});
