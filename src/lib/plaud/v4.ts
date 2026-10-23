import { z } from "zod";
import { AppError, ErrorCode } from "@/lib/errors";
import type { PlaudFileDetailResponse, PlaudRecording } from "@/types/plaud";

const nonnegative = z.number().finite().nonnegative();
const objectSchema = z.object({
    object_id: z.string().optional(),
    object_type: z.string(),
    content_url: z.string().nullable().optional(),
    content_id: z.string().nullable().optional(),
    task_status: z.number().nullable().optional(),
    safe_scan_status: z.number().optional(),
    version_ms: nonnegative.optional(),
});
const itemSchema = z.object({
    file_id: z.string().min(1),
    name: z.string(),
    duration_ms: nonnegative.optional(),
    created_at_show_ms: nonnegative.optional(),
    updated_at_show_ms: nonnegative.optional(),
    version_ms: nonnegative.optional(),
});
export const v4ListSchema = z.object({
    data: z.object({
        items: z.array(itemSchema),
        next_cursor: z.string().nullable().optional(),
    }),
});
export const v4ContentUrlsSchema = z.object({
    data: z.object({ url_map: z.record(z.string(), z.string().min(1)) }),
});
export const v4DetailSchema = z.object({
    data: z.object({
        meta: z.object({
            file_id: z.string().min(1),
            duration: nonnegative,
            size_bytes: nonnegative,
            start_time: nonnegative,
            version_ms: nonnegative,
            timezone: z.number().optional(),
        }),
        node: z
            .object({
                node_id: z.string(),
                name: z.string(),
                version_ms: nonnegative.optional(),
            })
            .optional(),
        objects: z.array(objectSchema),
    }),
});
export type V4Item = z.infer<typeof itemSchema>;
export type V4Detail = z.infer<typeof v4DetailSchema>["data"];

/** Reject malformed upstream responses without logging private response bodies. */
export function parseV4<T>(schema: z.ZodType<T>, body: unknown): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        throw new AppError(
            ErrorCode.PLAUD_UPSTREAM_ERROR,
            "Plaud returned an invalid v4 response.",
            502,
        );
    return parsed.data;
}

/** Match the official client's safety filter and completed-content selection. */
export function usableV4Object(object: V4Detail["objects"][number]): boolean {
    return (
        object.safe_scan_status !== 2 &&
        object.safe_scan_status !== 3 &&
        object.task_status !== 0 &&
        Boolean(object.content_url)
    );
}

/** Adapt v4 metadata to the existing sync model; timestamps and durations are milliseconds. */
export function v4Recording(item: V4Item, detail: V4Detail): PlaudRecording {
    if (item.file_id !== detail.meta.file_id)
        throw new AppError(
            ErrorCode.PLAUD_UPSTREAM_ERROR,
            "Plaud returned mismatched file metadata.",
            502,
        );
    const meta = detail.meta;
    const duration = item.duration_ms ?? meta.duration;
    const version = Math.max(
        meta.version_ms,
        detail.node?.version_ms ?? 0,
        item.version_ms ?? 0,
        item.updated_at_show_ms ?? 0,
        ...detail.objects.map((object) => object.version_ms ?? 0),
    );
    return {
        id: item.file_id,
        filename: item.name,
        duration,
        start_time: meta.start_time,
        end_time: meta.start_time + duration,
        version_ms: version,
        version: version,
        edit_time: version,
        filesize: meta.size_bytes,
        filetype: "",
        fullname: item.name,
        ori_ready: detail.objects.some(
            (object) =>
                object.object_type === "AUDIO" && usableV4Object(object),
        ),
        keywords: [],
        edit_from: "",
        is_trash: false,
        timezone: meta.timezone,
        filetag_id_list: [],
        is_trans: detail.objects.some(
            (object) =>
                object.object_type === "TRANSCRIPT" && usableV4Object(object),
        ),
        is_summary: detail.objects.some(
            (object) =>
                object.object_type === "SUMMARY" && usableV4Object(object),
        ),
    };
}

/** Preserve raw transcripts and primary summaries without substituting polished text. */
export function v4Content(detail: V4Detail): PlaudFileDetailResponse {
    const types: Record<string, string> = {
        TRANSCRIPT: "transaction",
        SUMMARY: "auto_sum_note",
        OUTLINE: "outline",
        POLISHED_TRANSCRIPT: "transaction_polish",
    };
    return {
        status: 0,
        data: {
            file_id: detail.meta.file_id,
            file_name: detail.node?.name,
            duration: detail.meta.duration,
            start_time: detail.meta.start_time,
            content_list: detail.objects
                .filter(usableV4Object)
                .map((object) => ({
                    data_id: object.object_id,
                    data_type: types[object.object_type] ?? object.object_type,
                    task_status: 1,
                    data_link: object.content_url ?? undefined,
                })),
        },
    };
}
