// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ReportBrief } from "@/components/recordings/report-brief";
import { ReportImage } from "@/components/recordings/report-image";
import { isVisualOptions, NO_VISUALS } from "@/lib/ai/report-visuals";

it("defaults to text only and rejects incomplete visual settings", () => {
    expect(NO_VISUALS).toEqual({ mindMap: false, tagChart: false });
    expect(isVisualOptions(NO_VISUALS)).toBe(true);
    expect(isVisualOptions({ mindMap: "false", tagChart: false })).toBe(false);
    expect(isVisualOptions({ mindMap: true })).toBe(false);
});

it("preserves report facts in the mind map", () => {
    const items = [
        "接口 <script> & 3.5 ms，状态待确认。".repeat(5),
        "الموعد 12/03",
    ];
    const markup = renderToStaticMarkup(
        <ReportImage title="图" groups={[{ label: "行动项", items }]} />,
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
it("groups related topics and keeps legacy facts, deadlines and pending decisions", () => {
    const report = {
        promptId: "meeting-notes" as const,
        summary: "先确认硬件。后续待定。",
        keyPoints: [
            "项目甲：接口待确认",
            "项目甲：延至 12/03",
            "接口 https://a.test 有效",
        ],
        actionItems: ["周五复核"],
    };
    const html = renderToStaticMarkup(
        <ReportBrief title="项目进展" report={report} />,
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    const labels = Array.from(
        doc.querySelectorAll("text"),
        (n) => n.textContent,
    );
    expect(labels.filter((s) => s === "项目甲")).toHaveLength(1);
    for (const value of [
        "项目进展",
        "先确认硬件。",
        "接口待确认",
        "12/03",
        "https://a.test",
        "周五复核",
    ])
        expect(doc.body.textContent).toContain(value);
});
