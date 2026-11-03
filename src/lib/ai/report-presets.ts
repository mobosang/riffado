import { SUMMARY_PRESETS } from "./summary-presets";

function template(
    id: string,
    name: string,
    description: string,
    focus: string,
) {
    return {
        id,
        name,
        description,
        prompt: `根据转写编写${name}。${focus}
仅使用原文信息。涉及多个项目时分别记录。不得推断评审通过、测试达标、责任人或截止日期；必要信息缺失时标为待确认。
Follow the configured output language, otherwise match the transcript language. Return only JSON: {"summary":"分段记录主要结论及其依据","keyPoints":["事实、风险或待确认事项"],"actionItems":["已约定的行动，附原文明确的责任人和时限"]}. Use empty arrays when appropriate.
Transcription:
{transcription}`,
    };
}

export const REPORT_PRESETS = {
    ...SUMMARY_PRESETS,
    "meeting-review": template(
        "meeting-review",
        "Meeting Review",
        "Separate objections, decisions and conditions for closure.",
        "逐项记录评审对象及版本、争议双方的理由、已采纳意见和遗留分歧；区分建议与主持人明确宣布的结论。",
    ),
    weekly: template(
        "weekly",
        "Weekly Team Meeting",
        "Track progress, blockers and next week’s commitments by project.",
        "按项目对照上周承诺与本周实际交付，区别已完成、进行中和延期；写出延期原因、依赖谁协调，以及下周可验收的交付物。",
    ),
    "requirements-review": template(
        "requirements-review",
        "Software Requirements Review",
        "Check scope, acceptance criteria and unresolved requirements.",
        "按需求编号或名称梳理用户场景、范围内外、功能与非功能约束；对每项争议写出现有表述、歧义、验收条件和变更影响。",
    ),
    "technical-proposal": template(
        "technical-proposal",
        "System Technical Proposal Review",
        "Compare technical options, constraints and validation risks.",
        "从系统层面列出任务目标、候选技术路线、软硬件分工、外部依赖；对照性能、成本、工期说明选型依据，指出需样机或试验验证的假设。",
    ),
    "architecture-review": template(
        "architecture-review",
        "Software High-Level Design Review",
        "Trace requirements to modules, interfaces and integration.",
        "围绕软件架构，说明需求分配到哪些模块、各模块职责、依赖方向、接口契约和关键数据流；指出职责空缺、耦合风险及集成验证办法。",
    ),
    "detail-review": template(
        "detail-review",
        "Software Detailed Design Review",
        "Examine algorithms, state transitions and error paths.",
        "按模块或函数记录输入输出、算法步骤、数据结构、状态转换和边界条件。将异常处理、并发或资源释放缺陷对应到触发条件与单元测试用例。",
    ),
    "development-review": template(
        "development-review",
        "Development Completion Review",
        "Compare target and measured results against delivery evidence.",
        "按任务书目标梳理研制历程、交付物及版本。逐项对照目标值、实测值、验证方式与证据，区分达标、未达标和未验证；记录质量问题关闭情况与交付限制。",
    ),
};
export type ReportPreset = keyof typeof REPORT_PRESETS;
