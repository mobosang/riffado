import { describe, expect, it } from "vitest";
import {
    type VoiceProfile,
    type VoiceSample,
    voiceprintLibrary,
    voiceprintProvider,
    voiceSample,
} from "@/lib/voiceprints/format";
import { matchSpeakerNames, selectSpeakerClips } from "@/lib/voiceprints/match";

function sample(embedding: [number, number], revision = "v1"): VoiceSample {
    return {
        model: { id: "vendor/model", revision, dimension: 2 },
        embedding,
    };
}

const known = sample([1, 0]);
const profile: VoiceProfile = {
    id: "person-a",
    name: "王工",
    samples: [known],
};

describe("voiceprint matching", () => {
    it("requires two agreeing clips and keeps unknown speakers numbered", () => {
        const different = sample([0, 1]);
        const probes = new Map([
            ["说话人 4", [sample([1, 0.2]), sample([1, -0.2])]],
            ["说话人 1", [different, different]],
            ["说话人 2", [known, different]],
            ["说话人 3", [known]],
        ]);
        expect(matchSpeakerNames(probes, [profile])).toEqual(
            new Map([["说话人 4", "王工"]]),
        );
    });

    it("rejects ambiguous profiles and a match claimed by two labels", () => {
        const probes = new Map([["说话人 2", [known, known]]]);
        const competing = {
            ...profile,
            id: "person-b",
            name: "李工",
            samples: [sample([1, 0.1])],
        };
        expect(matchSpeakerNames(probes, [profile, competing]).size).toBe(0);
        probes.set("说话人 1", [known, known]);
        expect(matchSpeakerNames(probes, [profile]).size).toBe(0);
    });

    it("never compares vectors from another model ID or revision", () => {
        const other = sample([1, 0], "v2");
        expect(
            matchSpeakerNames(new Map([["说话人 1", [other, other]]]), [
                profile,
            ]).size,
        ).toBe(0);
        other.model.id = "another/model";
        other.model.revision = "v1";
        expect(
            matchSpeakerNames(new Map([["说话人 1", [other, other]]]), [
                profile,
            ]).size,
        ).toBe(0);
    });

    it("joins adjacent turns, trims overlaps and ignores uncertain speakers", () => {
        const clips = selectSpeakerClips([
            { start: 0, end: 2.5, speaker: "说话人 1", text: "第一句" },
            { start: 2.6, end: 8, speaker: "说话人 1", text: "第二句" },
            { start: 7.8, end: 10, speaker: "重叠发言", text: "打断" },
            { start: 10.2, end: 11, speaker: "说话人 2", text: "太短" },
            { start: 12, end: 17, speaker: "说话人待确认", text: "待确认" },
        ]);
        expect([...clips.keys()]).toEqual(["说话人 1"]);
        const [first, second] = clips.get("说话人 1") ?? [];
        expect(first.start).toBeCloseTo(0.2);
        expect(first.text).toContain("第二句");
        expect(first.end).toBeLessThan(second.start);
        expect(second.end).toBeLessThan(7.8);
    });
});

describe("portable voiceprint data", () => {
    it("rejects zero vectors, dimension mismatches and duplicated profiles", () => {
        expect(voiceSample.safeParse(sample([0, 0])).success).toBe(false);
        expect(
            voiceSample.safeParse({ ...known, embedding: [1] }).success,
        ).toBe(false);
        expect(
            voiceprintLibrary.safeParse({
                format: "riffado.voiceprints",
                version: 1,
                profiles: [profile],
            }).success,
        ).toBe(true);
        expect(
            voiceprintLibrary.safeParse({
                format: "riffado.voiceprints",
                version: 1,
                profiles: [profile, profile],
            }).success,
        ).toBe(false);
    });

    it("accepts a local service and rejects malformed or credential-bearing endpoints", () => {
        for (const [endpoint, expected] of [
            ["http://voiceprints:9021/embed", true],
            ["not a url", false],
            ["http://user:password@voiceprints:9021/embed", false],
            ["http://voiceprints:9021/embed?key=key", false],
            ["file:///tmp/embed", false],
        ] as const) {
            expect(
                voiceprintProvider.safeParse({
                    endpoint,
                    name: "Local",
                    model: "vendor/model",
                }).success,
            ).toBe(expected);
        }
    });
});
