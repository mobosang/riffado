"use client";

import {
    type JSX,
    type ReactNode,
    useContext,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import { RecordingPlaybackContext } from "@/components/recordings/recording-playback-context";
import { Switch } from "@/components/ui/switch";
import { useUiText } from "@/lib/i18n/client";
import { isValidPlaudApiUrl } from "@/lib/plaud/servers";
import { cn } from "@/lib/utils";

function isSafeImageSrc(src: string): boolean {
    if (isValidPlaudApiUrl(src)) return true;
    if (!src.startsWith("/api/plaud-assets/")) return false;

    const base = "https://riffado.invalid";
    const normalized = new URL(src, base);
    return (
        normalized.origin === base &&
        normalized.pathname.startsWith("/api/plaud-assets/")
    );
}

// Inline markdown: bold, italic, inline code, strikethrough, and links.
function renderInline(text: string, keyPrefix: string): ReactNode[] {
    const nodes: ReactNode[] = [];
    // Ordered so the first match at a position wins.
    const pattern =
        /(\*\*([^*]+)\*\*)|(~~([^~]+)~~)|(`([^`]+)`)|(\*([^*]+)\*)|(_([^_]+)_)|(\[([^\]]+)\]\(([^)]+)\))/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex loop
    while ((m = pattern.exec(text)) !== null) {
        if (m.index > last) nodes.push(text.slice(last, m.index));
        const k = `${keyPrefix}-i${i++}`;
        if (m[1]) nodes.push(<strong key={k}>{m[2]}</strong>);
        else if (m[3])
            nodes.push(
                <del key={k} className="opacity-70">
                    {m[4]}
                </del>,
            );
        else if (m[5])
            nodes.push(
                <code
                    key={k}
                    className="rounded bg-black/20 px-1 py-0.5 font-mono text-[0.85em]"
                >
                    {m[6]}
                </code>,
            );
        else if (m[7]) nodes.push(<em key={k}>{m[8]}</em>);
        else if (m[9]) nodes.push(<em key={k}>{m[10]}</em>);
        else if (m[11]) {
            const href = m[13];
            // Same-origin paths and https only. A leading "//" (or "/\") is
            // protocol-relative and resolves to an EXTERNAL host, so it must not
            // pass the "/" check.
            const safe =
                href.startsWith("https://") ||
                (href.startsWith("/") &&
                    !href.startsWith("//") &&
                    !href.startsWith("/\\"));
            nodes.push(
                safe ? (
                    <a
                        key={k}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-cyan underline underline-offset-2"
                    >
                        {m[12]}
                    </a>
                ) : (
                    m[12]
                ),
            );
        }
        last = pattern.lastIndex;
    }
    if (last < text.length) nodes.push(text.slice(last));
    return nodes;
}

const HR_RE = /^\s*([-*_])\1{2,}\s*$/; // ---, ***, ___ (3+)
const IMG_RE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^\s*[-*]\s+(.*)$/;
const CHECK_RE = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/;
const ORDERED_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;

/**
 * Render the markdown subset Plaud emits in summaries: headings, bold,
 * italic, strikethrough, inline code, bullet/ordered/checkbox lists,
 * blockquotes, horizontal rules, links, and images.
 *
 * Output is built from React elements, never `dangerouslySetInnerHTML`, so
 * every text run is auto-escaped. Image sources are restricted to
 * same-origin asset routes and `https:`, and link hrefs to `https:` and
 * same-origin paths, so summary content cannot introduce a `data:` or
 * `javascript:` URL. Anything unrecognised falls through as plain text.
 */
export function RichMarkdown({
    content,
    className,
}: {
    content: string;
    className?: string;
}): JSX.Element {
    const uiText = useUiText();
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const blocks: ReactNode[] = [];
    let para: string[] = [];
    let list: {
        ordered: boolean;
        start?: number;
        items: { text: string; check?: boolean }[];
    } | null = null;
    let quote: string[] = [];
    let b = 0;

    const flushPara = () => {
        if (para.length) {
            const key = `p${b++}`;
            blocks.push(
                <p key={key} className="leading-relaxed my-2">
                    {renderInline(para.join(" "), key)}
                </p>,
            );
            para = [];
        }
    };
    const flushList = () => {
        if (list) {
            const key = `l${b++}`;
            const ordered = list.ordered;
            const items = list.items.map((it, idx) => {
                // An ordered list keeps its native list-decimal marker, so it must NOT
                // become a flex row and must not get a bullet injected - either would
                // suppress the number. Only unordered rows use the flex + marker layout.
                const marker =
                    it.check !== undefined ? (
                        <input
                            type="checkbox"
                            checked={it.check}
                            readOnly
                            className="mt-1.5 shrink-0 accent-accent-cyan"
                        />
                    ) : ordered ? null : (
                        <span className="mt-1.5 size-1.5 rounded-full bg-accent-cyan shrink-0" />
                    );
                return (
                    <li
                        // biome-ignore lint/suspicious/noArrayIndexKey: parsed output is rebuilt from scratch on every render and never reordered
                        key={`${key}-${idx}`}
                        className={
                            marker
                                ? "leading-relaxed flex gap-2 items-start"
                                : "leading-relaxed"
                        }
                    >
                        {marker}
                        {marker ? (
                            <span>
                                {renderInline(it.text, `${key}-${idx}`)}
                            </span>
                        ) : (
                            renderInline(it.text, `${key}-${idx}`)
                        )}
                    </li>
                );
            });
            blocks.push(
                ordered ? (
                    <ol
                        key={key}
                        start={list.start}
                        className="my-2 space-y-1 list-decimal pl-5"
                    >
                        {items}
                    </ol>
                ) : (
                    <ul key={key} className="my-2 space-y-1">
                        {items}
                    </ul>
                ),
            );
            list = null;
        }
    };
    const flushQuote = () => {
        if (quote.length) {
            const key = `q${b++}`;
            blocks.push(
                <blockquote
                    key={key}
                    className="my-2 border-l-2 border-accent-cyan/60 pl-3 italic text-muted-foreground"
                >
                    {renderInline(quote.join(" "), key)}
                </blockquote>,
            );
            quote = [];
        }
    };
    const flushAll = () => {
        flushPara();
        flushList();
        flushQuote();
    };

    for (const raw of lines) {
        const line = raw.trimEnd();
        if (!line.trim()) {
            flushAll();
            continue;
        }

        const img = line.match(IMG_RE);
        if (img) {
            flushAll();
            if (isSafeImageSrc(img[2])) {
                blocks.push(
                    // biome-ignore lint/performance/noImgElement: remote object-storage asset behind an auth-gated route, not a bundled static asset next/image can optimize
                    <img
                        key={`img${b++}`}
                        src={img[2]}
                        alt={img[1] || uiText("summary graphic")}
                        className="my-3 max-w-full rounded-lg border border-border"
                        loading="lazy"
                    />,
                );
            } else {
                blocks.push(
                    <p key={`p${b++}`} className="leading-relaxed my-2">
                        {line}
                    </p>,
                );
            }
            continue;
        }

        if (HR_RE.test(line)) {
            flushAll();
            blocks.push(<hr key={`hr${b++}`} className="my-4 border-border" />);
            continue;
        }

        const h = line.match(HEADING_RE);
        if (h) {
            flushAll();
            const level = Math.min(h[1].length, 6);
            const key = `h${b++}`;
            const inner = renderInline(h[2], key);
            const cls: Record<number, string> = {
                1: "text-xl font-bold mt-4 mb-2",
                2: "text-lg font-semibold mt-4 mb-2",
                3: "text-base font-semibold mt-3 mb-1",
                4: "text-sm font-semibold mt-2 mb-1",
                5: "text-sm font-medium mt-2 mb-1",
                6: "text-xs font-medium uppercase tracking-wide mt-2 mb-1",
            };
            const c = cls[level];
            blocks.push(
                level === 1 ? (
                    <h1 key={key} className={c}>
                        {inner}
                    </h1>
                ) : level === 2 ? (
                    <h2 key={key} className={c}>
                        {inner}
                    </h2>
                ) : level === 3 ? (
                    <h3 key={key} className={c}>
                        {inner}
                    </h3>
                ) : level === 4 ? (
                    <h4 key={key} className={c}>
                        {inner}
                    </h4>
                ) : level === 5 ? (
                    <h5 key={key} className={c}>
                        {inner}
                    </h5>
                ) : (
                    <h6 key={key} className={c}>
                        {inner}
                    </h6>
                ),
            );
            continue;
        }

        const q = line.match(QUOTE_RE);
        if (q) {
            flushPara();
            flushList();
            quote.push(q[1]);
            continue;
        }
        flushQuote();

        const chk = line.match(CHECK_RE);
        if (chk) {
            flushPara();
            if (!list || list.ordered) {
                flushList();
                list = { ordered: false, items: [] };
            }
            list.items.push({
                text: chk[2],
                check: chk[1].toLowerCase() === "x",
            });
            continue;
        }
        const bul = line.match(BULLET_RE);
        if (bul) {
            flushPara();
            if (!list || list.ordered) {
                flushList();
                list = { ordered: false, items: [] };
            }
            list.items.push({ text: bul[1] });
            continue;
        }
        const ord = line.match(ORDERED_RE);
        if (ord) {
            flushPara();
            if (!list || !list.ordered) {
                flushList();
                list = {
                    ordered: true,
                    start: Number.parseInt(ord[1], 10),
                    items: [],
                };
            }
            list.items.push({ text: ord[2] });
            continue;
        }

        flushList();
        para.push(line.trim());
    }
    flushAll();

    return <div className={className}>{blocks}</div>;
}

// Only the diarization label formats this app actually emits — `SPEAKER_00`
// (WhisperX), `Speaker 1` (Plaud), and the `UNKNOWN` fallback. A generic
// `Capitalized:` pattern would misread an ordinary transcript line such as
// `Question: ...` or `Action item: ...` as a speaker turn and wrongly switch a
// non-diarized transcript out of its plain-text fallback.
const SPEAKER_RE = /^(SPEAKER_\w+|Speaker\s+\w+|UNKNOWN):\s*(.*)$/;
const TIMESTAMP_RE = /^\[((?:\d{1,3}:)?[0-5]?\d:[0-5]\d)\]\s+(.+)$/;
const SPEAKER_HEADER_RE = /^Speaker\s+\w+(?:\s+·\s+Part\s+\d+)?$/;
const INLINE_SPEAKER_RE = /^([^:：]+)([:：])\s*(.*)$/;

const SPEAKER_COLORS = [
    "text-accent-cyan",
    "text-emerald-800 dark:text-emerald-400",
    "text-amber-800 dark:text-amber-400",
    "text-violet-800 dark:text-violet-400",
    "text-rose-800 dark:text-rose-400",
    "text-sky-800 dark:text-sky-400",
];

interface SpeakerTurn {
    lineNumber: number;
    speaker: string | null;
    label: string | null;
    text: string;
    startTime: number | null;
}

function parseSpeakerTurns(text: string): SpeakerTurn[] | null {
    const lines = text
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

    const turns: SpeakerTurn[] = [];
    for (const [lineNumber, line] of lines.entries()) {
        const labeled = line.match(SPEAKER_RE);
        const timestamped = line.match(TIMESTAMP_RE);
        if (labeled) {
            turns.push({
                lineNumber,
                speaker: labeled[1],
                label: `${labeled[1]}:`,
                text: labeled[2],
                startTime: null,
            });
        } else if (timestamped) {
            const [, timestamp, body] = timestamped;
            const inline = body.match(INLINE_SPEAKER_RE);
            const speaker =
                inline?.[1] ?? (SPEAKER_HEADER_RE.test(body) ? body : null);
            const label = speaker ? ` ${speaker}${inline?.[2] ?? ""}` : "";
            turns.push({
                lineNumber,
                speaker,
                label: `[${timestamp}]${label}`,
                text: inline?.[3] ?? (speaker ? "" : body),
                startTime: timestamp
                    .split(":")
                    .reduce((seconds, part) => seconds * 60 + Number(part), 0),
            });
        } else if (turns.length) {
            turns[turns.length - 1].text += ` ${line}`;
        } else {
            turns.push({
                lineNumber,
                speaker: null,
                label: null,
                text: line,
                startTime: null,
            });
        }
    }
    return turns.some((turn) => turn.label !== null) ? turns : null;
}

/** Render speaker turns and connect timestamped rows to the surrounding player. */
export function SpeakerTranscript({
    text,
    className,
}: {
    text: string;
    className?: string;
}): JSX.Element {
    const uiText = useUiText();
    const playback = useContext(RecordingPlaybackContext);
    const seekToTime = playback?.seekToTime;
    const turns = useMemo(() => parseSpeakerTurns(text), [text]);
    const hasTimeline = Boolean(
        seekToTime && turns?.some((turn) => turn.startTime !== null),
    );
    const [followPlayback, setFollowPlayback] = useState(true);
    const followId = useId();
    const scrollRef = useRef<HTMLDivElement>(null);
    const activeRowRef = useRef<HTMLButtonElement>(null);

    let activeTurn: SpeakerTurn | undefined;
    if (playback && turns) {
        for (const turn of turns) {
            if (
                turn.startTime !== null &&
                turn.startTime <= playback.currentTime &&
                turn.startTime > (activeTurn?.startTime ?? -1)
            ) {
                activeTurn = turn;
            }
        }
    }

    useEffect(() => {
        if (!hasTimeline || !followPlayback) return;
        const viewport = scrollRef.current;
        if (!viewport?.clientHeight) return;
        if (!activeTurn) {
            if (viewport.scrollTop > 0) {
                viewport.scrollBy({ top: -viewport.scrollTop });
            }
            return;
        }
        const row = activeRowRef.current;
        if (!row) return;

        const viewportTop =
            viewport.getBoundingClientRect().top + viewport.clientTop;
        const bounds = row.getBoundingClientRect();
        const inset = 8;
        const top = bounds.top - viewportTop;
        const bottom = bounds.bottom - viewportTop;
        if (top < inset || bounds.height > viewport.clientHeight - 2 * inset) {
            viewport.scrollBy({ top: top - inset });
        } else if (bottom > viewport.clientHeight - inset) {
            viewport.scrollBy({ top: bottom - viewport.clientHeight + inset });
        }
    }, [activeTurn, followPlayback, hasTimeline]);

    const rows = useMemo(() => {
        const order: string[] = [];
        const colorFor = (speaker: string) => {
            let idx = order.indexOf(speaker);
            if (idx === -1) {
                order.push(speaker);
                idx = order.length - 1;
            }
            return SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
        };
        return turns?.map((turn) => {
            const { lineNumber, startTime } = turn;
            const content = (
                <>
                    {turn.label && (
                        <span
                            dir="ltr"
                            className={cn(
                                "me-2 font-semibold",
                                turn.speaker
                                    ? colorFor(turn.speaker)
                                    : "text-muted-foreground",
                            )}
                        >
                            {turn.label}
                        </span>
                    )}
                    <bdi dir="auto">{turn.text}</bdi>
                </>
            );

            if (!seekToTime || startTime === null) {
                return (
                    <div key={lineNumber} className="leading-relaxed">
                        {content}
                    </div>
                );
            }

            return (
                <button
                    key={lineNumber}
                    ref={turn === activeTurn ? activeRowRef : undefined}
                    type="button"
                    aria-current={turn === activeTurn ? "time" : undefined}
                    className={cn(
                        "block w-full cursor-pointer select-text rounded-md px-2 py-1 text-start leading-relaxed wrap-anywhere hover:bg-background/70 focus-visible:outline-2 focus-visible:outline-ring",
                        startTime === activeTurn?.startTime &&
                            "bg-primary/15 ring-1 ring-primary/40 ring-inset hover:bg-primary/20",
                    )}
                    onClick={(event) => {
                        const selection = window.getSelection();
                        if (
                            event.detail &&
                            selection &&
                            !selection.isCollapsed &&
                            event.currentTarget.contains(selection.anchorNode)
                        )
                            return;
                        seekToTime(startTime);
                    }}
                >
                    {content}
                </button>
            );
        });
    }, [turns, seekToTime, activeTurn]);

    if (!turns) {
        return (
            <p className={cn("whitespace-pre-wrap leading-relaxed", className)}>
                {text}
            </p>
        );
    }

    const body = (
        <div
            ref={scrollRef}
            className={cn(hasTimeline ? "space-y-1" : "space-y-3", className)}
        >
            {rows}
        </div>
    );
    return hasTimeline ? (
        <div className="space-y-2">
            <label
                htmlFor={followId}
                className="ms-auto flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground"
            >
                {uiText("Follow playback")}
                <Switch
                    id={followId}
                    checked={followPlayback}
                    onCheckedChange={setFollowPlayback}
                />
            </label>
            {body}
        </div>
    ) : (
        body
    );
}
