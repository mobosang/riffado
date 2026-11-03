// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ReportImage } from "@/components/recordings/report-image";
import { isVisualOptions, NO_VISUALS } from "@/lib/ai/report-visuals";

it("defaults to text only and rejects incomplete visual settings", () => {
    expect(NO_VISUALS).toEqual({ mindMap: false, tagChart: false });
    expect(isVisualOptions(NO_VISUALS)).toBe(true);
    expect(isVisualOptions({ mindMap: "false", tagChart: false })).toBe(false);
    expect(isVisualOptions({ mindMap: true })).toBe(false);
});

it.each([
    "mindMap",
    "tagChart",
] as const)("preserves report facts in %s", (kind) => {
    const items = [
        "接口 <script> & 3.5 ms，状态待确认。".repeat(5),
        "الموعد 12/03",
    ];
    const markup = renderToStaticMarkup(
        <ReportImage
            kind={kind}
            title="图"
            groups={[{ label: "行动项", items }]}
        />,
    );
    const doc = new DOMParser().parseFromString(markup, "text/html");
    expect(
        Array.from(
            doc.querySelectorAll("g > g > text"),
            (node) => node.textContent,
        ),
    ).toEqual(items);
    expect(doc.querySelector("script")).toBeNull();
});
