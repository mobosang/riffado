import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUiLocale, getUiText } from "@/lib/i18n/server";

const { cookieStore } = vi.hoisted(() => ({ cookieStore: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: cookieStore }));

beforeEach(() => cookieStore.mockReset());

describe("request-scoped UI language", () => {
    it("reads the saved preference and defaults unknown or absent values to English", async () => {
        for (const [stored, expected] of [
            [undefined, "en"],
            ["fr", "en"],
            ["zh-CN", "zh-CN"],
            ["en", "en"],
        ]) {
            cookieStore.mockResolvedValueOnce({
                get: () => (stored ? { value: stored } : undefined),
            });
            expect(await getUiLocale()).toBe(expected);
        }
    });

    it("keeps concurrent English and Chinese requests isolated", async () => {
        let resolveChinese!: (store: { get: () => { value: string } }) => void;
        cookieStore.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveChinese = resolve;
            }),
        );
        cookieStore.mockResolvedValueOnce({ get: () => ({ value: "en" }) });
        const chineseRequest = getUiText();
        const english = await getUiText();
        resolveChinese({ get: () => ({ value: "zh-CN" }) });
        const chinese = await chineseRequest;
        expect(chinese("Settings")).toBe("设置");
        expect(english("Settings")).toBe("Settings");
    });
});
