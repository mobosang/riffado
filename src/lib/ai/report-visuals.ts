export const VISUAL_PROMPTS = {
    mindMap:
        "The report will also be a mind map. Make each key point or action self-contained and group only facts that belong to the same project. Preserve dependencies, uncertainty, numbers, units, owners and deadlines. Do not invent links or produce diagram code.",
    tagChart:
        "The report doubles as a one-page decision brief. Begin summary with one concise takeaway. Format each keyPoints string as a short topic name, a colon and space, then a concise decision or status with its evidence. Prefer one topic per point. Preserve exact numbers, dates, conditions and uncertainty. In actionItems include owners and deadlines only when stated. Keep the requested JSON fields and output language.",
};
export type VisualKind = keyof typeof VISUAL_PROMPTS;
export interface VisualOptions {
    mindMap: boolean;
    tagChart: boolean;
}
export const NO_VISUALS: VisualOptions = { mindMap: false, tagChart: false };
export function isVisualOptions(value: unknown): value is VisualOptions {
    return (
        typeof value === "object" &&
        value !== null &&
        "mindMap" in value &&
        typeof value.mindMap === "boolean" &&
        "tagChart" in value &&
        typeof value.tagChart === "boolean" &&
        Object.keys(value).length === 2
    );
}
