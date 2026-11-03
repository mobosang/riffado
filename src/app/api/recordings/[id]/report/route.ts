import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { decryptJsonField } from "@/lib/encryption/fields";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { generateSummaryForRecording } from "@/lib/summary/generate-summary";

type Context = { params: Promise<{ id: string }> };
export const GET = apiHandler<Context>(async (req, ctx) => {
    const { user } = await requireApiSession(req);
    const { id } = await (ctx as Context).params;
    const [row] = await db
        .select({ report: recordings.report })
        .from(recordings)
        .where(
            and(
                eq(recordings.id, id),
                eq(recordings.userId, user.id),
                isNull(recordings.deletedAt),
            ),
        )
        .limit(1);
    if (!row)
        throw new AppError(
            ErrorCode.RECORDING_NOT_FOUND,
            "Recording not found",
            404,
        );
    return NextResponse.json(decryptJsonField(row.report));
});
export const POST = apiHandler<Context>(async (req, ctx) => {
    const { user } = await requireApiSession(req);
    const { id } = await (ctx as Context).params;
    return NextResponse.json(
        await generateSummaryForRecording(user.id, id, { report: true }),
    );
});
