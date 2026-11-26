import {
    MAX_SAMPLE_SECONDS,
    MIN_SAMPLE_SECONDS,
    type SpeakerSegment,
    type VoiceProfile,
    type VoiceSample,
} from "@/lib/voiceprints/format";

const MIN_SIMILARITY = 0.62;
const MIN_MARGIN = 0.12;
const EDGE_PADDING = 0.2;

export function selectSpeakerClips(segments: SpeakerSegment[]) {
    const ordered = [...segments].sort((a, b) => a.start - b.start);
    const turns: SpeakerSegment[] = [];
    for (const segment of ordered) {
        const previous = turns.at(-1);
        if (
            previous?.speaker === segment.speaker &&
            segment.start <= previous.end + 0.35
        ) {
            previous.end = Math.max(previous.end, segment.end);
            previous.text += ` ${segment.text}`;
        } else {
            turns.push({ ...segment });
        }
    }
    const speakers = new Map<string, SpeakerSegment[]>();
    let priorEnd = 0;
    for (const [index, segment] of turns.entries()) {
        const start = Math.max(segment.start, priorEnd) + EDGE_PADDING;
        const end =
            Math.min(segment.end, turns[index + 1]?.start ?? segment.end) -
            EDGE_PADDING;
        priorEnd = Math.max(priorEnd, segment.end);
        if (
            end - start < MIN_SAMPLE_SECONDS ||
            !/^(?:说话人|Speaker)\s+\d+$/i.test(segment.speaker)
        ) {
            continue;
        }
        const clips = speakers.get(segment.speaker) ?? [];
        clips.push({ ...segment, start, end });
        speakers.set(segment.speaker, clips);
    }

    for (const [speaker, clips] of speakers) {
        clips.sort((a, b) => b.end - b.start - (a.end - a.start));
        const [first, second] = clips;
        if (
            !second &&
            first.end - first.start >= 2 * MIN_SAMPLE_SECONDS + EDGE_PADDING
        ) {
            clips.push({ ...first, start: first.end - MIN_SAMPLE_SECONDS });
            first.end -= MIN_SAMPLE_SECONDS + EDGE_PADDING;
        }
        speakers.set(
            speaker,
            clips.slice(0, 2).map((clip) => ({
                ...clip,
                end: Math.min(clip.end, clip.start + MAX_SAMPLE_SECONDS),
            })),
        );
    }
    return speakers;
}

function cosine(a: VoiceSample, b: VoiceSample): number {
    if (
        a.model.id !== b.model.id ||
        a.model.revision !== b.model.revision ||
        a.model.dimension !== b.model.dimension
    ) {
        return -1;
    }
    const dot = a.embedding.reduce(
        (sum, value, index) => sum + value * b.embedding[index],
        0,
    );
    return dot / (Math.hypot(...a.embedding) * Math.hypot(...b.embedding));
}

export function matchSpeakerNames(
    probes: ReadonlyMap<string, VoiceSample[]>,
    profiles: VoiceProfile[],
): Map<string, string> {
    const matches = new Map<string, string>();
    const reused = new Set<string>();
    for (const [speaker, samples] of probes) {
        if (samples.length < 2) continue;
        const matchesBySample = samples.map((sample) => {
            const scores = profiles
                .map((profile) => ({
                    profile,
                    score: Math.max(
                        ...profile.samples.map((ref) => cosine(sample, ref)),
                    ),
                }))
                .sort((a, b) => b.score - a.score);
            const [best, next] = scores;
            if (
                best &&
                best.score >= MIN_SIMILARITY &&
                (!next || best.score - next.score >= MIN_MARGIN)
            ) {
                return best.profile;
            }
            return undefined;
        });
        const [match] = matchesBySample;
        if (
            !match ||
            !matchesBySample.every((other) => other?.id === match.id)
        ) {
            continue;
        }
        if ([...matches.values()].includes(match.name)) reused.add(match.name);
        matches.set(speaker, match.name);
    }
    for (const [speaker, name] of matches) {
        if (reused.has(name)) matches.delete(speaker);
    }
    return matches;
}
