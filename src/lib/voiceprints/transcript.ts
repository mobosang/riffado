import type { VoiceProfile } from "@/lib/voiceprints/format";

const TIMED_LINE = /^([ \t]*\[((?:\d{1,3}:)?[0-5]?\d:[0-5]\d)\][ \t]+)(.*)$/;
const SPEAKER_LINE = /^([^:：]+?)([ \t]*[:：].*)$/;
const NUMBERED_SPEAKER = /^(?:说话人|Speaker)[ \t]+\d+$/i;
const NAMED_SPEAKER = /^(.+?)[（(]((?:说话人|Speaker)[ \t]+\d+)[）)]$/i;

export interface TranscriptSpeaker {
    speaker: string;
    name?: string;
    timestamp: string;
    excerpt: string;
    suggestedProfileId?: string;
}

export interface TranscriptNameEditor {
    revision: string;
    speakers: TranscriptSpeaker[];
}

function parseTurn(line: string) {
    const timed = TIMED_LINE.exec(line);
    if (!timed) return null;
    const [, prefix, timestamp, body] = timed;
    const start = timestamp
        .split(":")
        .reduce((time, part) => time * 60 + Number(part), 0);
    const labeled = SPEAKER_LINE.exec(body);
    const label = labeled?.[1] ?? "";
    const named = NAMED_SPEAKER.exec(label);
    return {
        prefix,
        timestamp,
        start,
        speaker: named?.[2] ?? (NUMBERED_SPEAKER.test(label) ? label : null),
        name: named?.[1],
        suffix: labeled?.[2] ?? "",
    };
}

export function listTranscriptSpeakers(
    text: string,
    profiles: VoiceProfile[],
    recordingId: string,
): TranscriptSpeaker[] {
    const turns = text
        .split(/\r\n|\n|\r/)
        .map(parseTurn)
        .filter((turn) => turn !== null)
        .sort((a, b) => a.start - b.start);
    const speakers = new Map<string, TranscriptSpeaker>();

    for (const { speaker, name, timestamp, suffix } of turns) {
        if (!speaker) continue;
        const entry = speakers.get(speaker);
        if (entry) {
            entry.name ??= name;
        } else {
            speakers.set(speaker, {
                speaker,
                name,
                timestamp,
                excerpt: suffix.replace(/^[ \t]*[:：][ \t]*/, "").slice(0, 120),
            });
        }
    }

    const suggestions = new Map<string, string | null>();
    for (const profile of profiles) {
        const labels = new Set<string | null>();
        for (const { source } of profile.samples) {
            if (source?.recordingId !== recordingId) continue;
            const first = turns.findLast((turn) => turn.start <= source.start);
            const speaker = first?.speaker ?? null;
            const crossesAnotherSpeaker =
                first &&
                turns.some(
                    (turn) =>
                        turn.start >= first.start &&
                        turn.start < source.end &&
                        turn.speaker !== speaker,
                );
            labels.add(crossesAnotherSpeaker ? null : speaker);
        }
        const [speaker] = labels;
        if (labels.size !== 1 || !speaker) continue;
        suggestions.set(speaker, suggestions.has(speaker) ? null : profile.id);
    }

    for (const [speaker, entry] of speakers) {
        const profileId = suggestions.get(speaker);
        if (profileId && !entry.name) entry.suggestedProfileId = profileId;
    }
    return [...speakers.values()];
}

export function applyTranscriptNames(
    text: string,
    names: ReadonlyMap<string, string>,
): string | null {
    const seen = new Set<string>();
    const updated = text
        .split(/(\r\n|\n|\r)/)
        .map((line) => {
            const turn = parseTurn(line);
            if (!turn?.speaker) return line;
            const name = names.get(turn.speaker);
            if (!name) return line;
            seen.add(turn.speaker);
            return name === turn.name
                ? line
                : `${turn.prefix}${name}（${turn.speaker}）${turn.suffix}`;
        })
        .join("");
    return seen.size === names.size ? updated : null;
}
