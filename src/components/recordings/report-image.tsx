import type { VisualKind } from "@/lib/ai/report-visuals";

interface Group {
    label: string;
    items: string[];
}

function lines(text: string, width: number) {
    const result: string[] = [];
    const segmenter = new Intl.Segmenter(undefined, {
        granularity: "grapheme",
    });
    for (const paragraph of text.split(/\r?\n/)) {
        let line = "",
            used = 0;
        for (const { segment } of segmenter.segment(paragraph)) {
            const size = /^[\x20-\x7E]$/.test(segment) ? 10 : 18;
            if (line && used + size > width) {
                result.push(line);
                line = "";
                used = 0;
            }
            line += segment;
            used += size;
        }
        result.push(line);
    }
    return result;
}

export function ReportImage({
    kind,
    title,
    groups,
}: {
    kind: VisualKind;
    title: string;
    groups: Group[];
}) {
    const tree = kind === "mindMap";
    const width = 680;
    let y = 58;
    const sections = groups
        .filter((g) => g.items.length)
        .map(({ label, items }, groupIndex) => {
            const color = ["#215e54", "#315582", "#765121"][groupIndex % 3];
            const start = y;
            y += 34;
            let rowHeight = 0;
            const nodes = [...new Set(items)].map((item, index, all) => {
                const w = tree ? 588 : 310;
                const x = tree ? 68 : 20 + (index % 2) * 328;
                const top = y;
                const wrapped = lines(item, w - 30);
                const h = wrapped.length * 22 + 16;
                rowHeight = Math.max(rowHeight, h);
                if (tree || index % 2 === 1 || index === all.length - 1) {
                    y += rowHeight + 10;
                    rowHeight = 0;
                }
                return (
                    <g key={item}>
                        {tree && (
                            <path
                                d={`M48 ${top - 10} V${top + h / 2} H${x} M48 ${top + h / 2} v${index === all.length - 1 ? 0 : h / 2 + 10}`}
                                stroke={color}
                                fill="none"
                            />
                        )}
                        <rect
                            x={x}
                            y={top}
                            width={w}
                            height={h}
                            rx={tree ? 6 : 16}
                            fill="#fff"
                            stroke={color}
                        />
                        <text fill="#172930" fontSize="15" xmlSpace="preserve">
                            {wrapped.map((line, i) => (
                                <tspan
                                    key={`${top + 22 * i}`}
                                    x={x + 14}
                                    y={top + 23 + 22 * i}
                                >
                                    {line}
                                </tspan>
                            ))}
                        </text>
                    </g>
                );
            });
            y += 10;
            return (
                <g key={label}>
                    {tree && (
                        <path
                            d={`M12 ${groupIndex === 0 ? 41 : start - 10} V${start + 13} H24 M12 ${start + 13} V${y - 10}`}
                            fill="none"
                            stroke="#68857b"
                        />
                    )}
                    <rect
                        x={24}
                        y={start}
                        width={200}
                        height={25}
                        rx={12}
                        fill={color}
                    />
                    <text x={35} y={start + 18} fill="white" fontSize="15">
                        {label}
                    </text>
                    {nodes}
                </g>
            );
        });
    return (
        <div className="overflow-x-auto">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                role="img"
                aria-label={title}
                viewBox={`0 0 ${width} ${y}`}
                className="w-full min-w-[32rem]"
                fontFamily="system-ui,sans-serif"
            >
                <title>{title}</title>
                <rect width={width} height={y} rx={10} fill="#f3f7f5" />
                <text
                    x={12}
                    y={32}
                    fontSize={19}
                    fontWeight="bold"
                    fill="#193d35"
                >
                    {title}
                </text>
                {sections}
            </svg>
        </div>
    );
}
