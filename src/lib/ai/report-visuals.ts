export const VISUAL_PROMPTS = {
    mindMap:
        "The report will also be a mind map. Make each key point or action self-contained and group only facts that belong to the same project. Preserve dependencies, uncertainty, numbers, units, owners and deadlines. Do not invent links or produce diagram code.",
    tagChart:
        "The report will also be a tag chart. Start each point and action with its specific topic, followed by the supporting detail. Keep names, status, measurements and conditions exactly as reported. Do not infer priorities or tag weights.",
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
