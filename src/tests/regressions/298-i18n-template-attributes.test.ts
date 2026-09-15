// biome-ignore-all lint/suspicious/noTemplateCurlyInString: Fixtures contain TypeScript source with literal interpolation syntax.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scanner = path.resolve("scripts/check-i18n.mjs");
const fixtureFile = "src/components/settings-sections/example.tsx";

function scan(source: string, exceptions: Record<string, string> = {}) {
    const directory = mkdtempSync(path.join(tmpdir(), "riffado-i18n-298-"));
    if (
        path.dirname(directory) !== path.resolve(tmpdir()) ||
        !path.basename(directory).startsWith("riffado-i18n-298-")
    )
        throw new Error("Unexpected fixture path");
    try {
        mkdirSync(path.join(directory, "src/lib/i18n"), { recursive: true });
        mkdirSync(path.join(directory, "src/components/settings-sections"), {
            recursive: true,
        });
        writeFileSync(
            path.join(directory, "src/lib/i18n/zh-CN.json"),
            JSON.stringify({ "Hello {name}": "你好 {name}" }),
        );
        writeFileSync(
            path.join(directory, "src/lib/i18n/allowlist.json"),
            JSON.stringify({ [fixtureFile]: exceptions }),
        );
        writeFileSync(path.join(directory, fixtureFile), source);
        const result = spawnSync(process.execPath, [scanner], {
            cwd: directory,
            encoding: "utf8",
        });
        if (result.error) throw result.error;
        return { status: result.status, output: result.stdout + result.stderr };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

describe("PR 298: localization template scanning", () => {
    it.each([
        '<input placeholder="Untranslated" />',
        '<input placeholder={"Untranslated"} />',
        "<input placeholder={`Untranslated\n{transcription}`} />",
        "<input placeholder={`Untranslated\n${transcription}`} />",
        "<div>{`Untranslated ${value}`}</div>",
        '<input aria-label={enabled ? `Untranslated ${value}` : uiText("Hello {name}", { name })} />',
        '<input title={`${"Untranslated"}`} />',
        '<div>{enabled && "Untranslated"}</div>',
        '<input placeholder={"Untranslated " + name} />',
        '<input title={("Untranslated" as string)} />',
    ])("reports visible English in %s", (source) => {
        const result = scan(source);
        expect(result.status).toBe(1);
        expect(result.output).toContain(
            `${fixtureFile}:1: Untranslated UI: Untranslated`,
        );
    });

    it.each([
        "`Hello ${name}`",
        "(`Hello ${name}`)",
        'enabled ? `Hello ${name}` : "Hello {name}"',
        '"Hello " + name',
    ])("rejects dynamic dictionary key %s", (key) => {
        const result = scan(`<input placeholder={uiText(${key})} />`);
        expect(result.status).toBe(1);
        expect(result.output).toContain("Dynamic translation key");
    });

    it("does not treat inherited object properties as explicit exceptions", () => {
        const result = scan('<input title="constructor" />');
        expect(result.status).toBe(1);
        expect(result.output).toContain("Untranslated UI: constructor");
    });

    it("checks literal template dictionary keys", () => {
        const result = scan("<input placeholder={uiText(`Missing`)} />");
        expect(result.status).toBe(1);
        expect(result.output).toContain("Missing dictionary key: Missing");
    });

    it("accepts named placeholders and runtime content without evaluating it", () => {
        const result = scan(
            '<><input placeholder={uiText("Hello {name}", { name })} /><div>{`${userContent}`}</div><input title={`${(() => { throw new Error("never execute"); })()}`} /><div className={`untranslated-${value}`} /></>',
        );
        expect(result.status).toBe(0);
    });

    it("requires exact explicit exceptions for multiline prompt examples", () => {
        const source =
            "<input placeholder={`Original prompt\n{transcription}`} />";
        expect(
            scan(source, {
                "Original prompt\n{transcription}":
                    "Keep AI instructions unchanged.",
            }).status,
        ).toBe(0);
        expect(
            scan(source, {
                "Original prompt": "Partial exceptions must not match.",
            }).status,
        ).toBe(1);
    });
});
