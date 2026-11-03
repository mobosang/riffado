import { REPORT_PRESETS, type ReportPreset } from "@/lib/ai/report-presets";
import { useUiText } from "@/lib/i18n/client";
import { wrapReportText } from "./report-image";

interface BriefReport {
    promptId: ReportPreset;
    summary: string;
    keyPoints: string[];
    actionItems: string[];
}

const fills = ["#eaf4fb", "#f7f3e5", "#e6f6f3", "#edf2fa"];

function TextBlock({
    lines,
    x,
    y,
    strong = false,
}: {
    lines: string[];
    x: number;
    y: number;
    strong?: boolean;
}) {
    return (
        <text x={x} y={y} fontWeight={strong ? 700 : 400} xmlSpace="preserve">
            {lines.map((line, index) => (
                <tspan key={y + 22 * index} x={x} dy={index === 0 ? 0 : 22}>
                    {line}
                </tspan>
            ))}
        </text>
    );
}

export function ReportBrief({
    title,
    report,
}: {
    title: string;
    report: BriefReport;
}) {
    const t = useUiText();
    const paletteTitle = t("Report brief");
    const heading = wrapReportText(title || paletteTitle, 620);
    const takeaway = report.summary
        .trim()
        .split(/(?<=[。！？])|(?<=[.!?])\s|\n/u, 1)[0];
    const lead = wrapReportText(takeaway, 690);
    const leadY = 58 + heading.length * 22;
    let y = leadY + lead.length * 22 + 8;
    const topics = new Map<string, string[]>();
    for (const point of report.keyPoints) {
        const match = /^([^\n：:]{1,60})(?:：\s*|:\s+)([\s\S]+)$/u.exec(point);
        const topic = match?.[1]?.trim() || t("Key Points");
        const facts = topics.get(topic) ?? [];
        facts.push(match?.[2] ?? point);
        topics.set(topic, facts);
    }
    const panels = [];
    const entries = [...topics.entries()];
    for (let i = 0; i < entries.length; i += 2) {
        const row = entries.slice(i, i + 2);
        const width = row.length === 1 ? 704 : 346;
        const cards = row.map(([topic, facts]) => ({
            topic,
            heading: wrapReportText(topic, width - 28),
            lines: facts.flatMap((fact) =>
                wrapReportText(
                    facts.length > 1 ? `• ${fact}` : fact,
                    width - 28,
                ),
            ),
        }));
        const height =
            34 +
            22 *
                Math.max(
                    ...cards.map((c) => c.heading.length + c.lines.length),
                );
        const top = y;
        panels.push(
            ...cards.map((card, column) => {
                const x = 16 + column * 358;
                return (
                    <g key={card.topic}>
                        <rect
                            x={x}
                            y={top}
                            width={width}
                            height={height}
                            rx={10}
                            fill={fills[(i + column) % fills.length]}
                        />
                        <TextBlock
                            x={x + 14}
                            y={top + 26}
                            lines={card.heading}
                            strong
                        />
                        <TextBlock
                            x={x + 14}
                            y={top + 32 + card.heading.length * 22}
                            lines={card.lines}
                        />
                    </g>
                );
            }),
        );
        y += height + 10;
    }
    const actions = report.actionItems.flatMap((item) =>
        wrapReportText(`• ${item}`, 670),
    );
    const footerHeight = actions.length ? 52 + actions.length * 22 : 0;
    return (
        <figure className="overflow-x-auto rounded-xl border">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                role="img"
                aria-label={paletteTitle}
                viewBox={`0 0 736 ${y + footerHeight + 12}`}
                className="w-full min-w-[32rem]"
                fill="#182d36"
                fontFamily="system-ui,sans-serif"
                fontSize={15}
            >
                <title>{paletteTitle}</title>
                <rect width="100%" height="100%" fill="#fbfcfa" />
                <text x={18} y={25} fontSize={13} fill="#34675d">
                    {paletteTitle} ·{" "}
                    {t(
                        REPORT_PRESETS[report.promptId]?.name ??
                            "Recording report",
                    )}
                </text>
                <g fontSize={19}>
                    <TextBlock x={18} y={54} lines={heading} strong />
                </g>
                <TextBlock x={18} y={leadY} lines={lead} />
                {panels}
                {actions.length > 0 && (
                    <g>
                        <rect
                            x={16}
                            y={y}
                            width={704}
                            height={footerHeight}
                            rx={10}
                            fill="#f7f3e5"
                        />
                        <TextBlock
                            x={30}
                            y={y + 25}
                            lines={[t("Action Items")]}
                            strong
                        />
                        <TextBlock x={30} y={y + 51} lines={actions} />
                    </g>
                )}
            </svg>
        </figure>
    );
}
