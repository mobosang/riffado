import { createHash } from "node:crypto";
import * as path from "node:path";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { getAudioDurationMs } from "@/lib/audio/duration";
import { requireApiSession } from "@/lib/auth-server";
import { encryptText } from "@/lib/encryption/fields";
import { isHostedLockedOut } from "@/lib/entitlements";
import { env } from "@/lib/env";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { enforceStorageCap } from "@/lib/hosted/billing/storage-cap";
import { decideHostnameGate } from "@/lib/hosted/hostname-gate";
import { captureServerEvent } from "@/lib/posthog-server";
import { deleteStorageObjectOrQueue } from "@/lib/storage/delete-object";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { getAudioMimeType } from "@/lib/utils";

const ACCEPTED_EXTENSIONS = new Set([
    ".mp3",
    ".mp4",
    ".m4a",
    ".wav",
    ".ogg",
    ".opus",
    ".webm",
    ".aac",
    ".flac",
]);

function uploadHostIsBlocked(request: Request): boolean {
    return (
        decideHostnameGate({
            requestHostname: request.headers.get("host") ?? "",
            pathname: "/api/recordings/upload",
            adminHostname: env.ADMIN_HOSTNAME,
        }).kind === "not-found"
    );
}

function unsupportedMethod(request: Request) {
    return new Response(null, {
        status: uploadHostIsBlocked(request) ? 404 : 405,
    });
}

export {
    unsupportedMethod as DELETE,
    unsupportedMethod as GET,
    unsupportedMethod as HEAD,
    unsupportedMethod as PATCH,
    unsupportedMethod as PUT,
};

export function OPTIONS(request: Request) {
    if (uploadHostIsBlocked(request))
        return new Response(null, { status: 404 });
    return new Response(null, {
        status: 204,
        headers: { Allow: "OPTIONS, POST" },
    });
}

export const POST = apiHandler(async (request: Request) => {
    if (uploadHostIsBlocked(request))
        return new Response(null, { status: 404 });

    const session = await requireApiSession(request);

    if (await isHostedLockedOut(session.user.id)) {
        throw new AppError(
            ErrorCode.ACCOUNT_LOCKED,
            "Your hosted plan has lapsed. Subscribe to resume uploads, or export your data.",
            403,
        );
    }

    const formData = await request.formData();
    const fileEntry = formData.get("file");

    if (!fileEntry || !(fileEntry instanceof File)) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "No file provided",
            400,
            { field: "file" },
        );
    }

    const file = fileEntry;

    // Reject files larger than 500 MB
    const MAX_FILE_SIZE = 500 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
        throw new AppError(
            ErrorCode.FILE_TOO_LARGE,
            "File exceeds the 500 MB size limit",
            413,
        );
    }

    // Storage cap: block the upload before reading the body when it would
    // push the user over their plan's storage limit. No-op on self-host.
    const cap = await enforceStorageCap({
        userId: session.user.id,
        additionalBytes: file.size,
    });
    if (!cap.allowed) {
        throw new AppError(
            ErrorCode.STORAGE_QUOTA_EXCEEDED,
            "This upload would exceed your plan's storage limit. Upgrade or free up space to continue.",
            413,
        );
    }

    const ext = path.extname(file.name).toLowerCase();

    if (!ACCEPTED_EXTENSIONS.has(ext)) {
        throw new AppError(
            ErrorCode.INVALID_FILE_FORMAT,
            `Unsupported format. Accepted: ${[...ACCEPTED_EXTENSIONS].join(", ")}`,
            400,
        );
    }

    // Read file into buffer (inline to avoid keeping the intermediate
    // ArrayBuffer in scope alongside the Buffer, which would briefly
    // double memory usage for large files)
    const buffer = Buffer.from(await file.arrayBuffer());

    // Unique ID and storage key for this upload
    const fileId = `uploaded-${nanoid()}`;
    const storageKey = `${session.user.id}/${fileId}${ext}`;
    // Always derive content type from the validated extension — never
    // trust the user-supplied file.type, which could be set to text/html
    // and cause a stored XSS if the file is ever served directly.
    const contentType = getAudioMimeType(storageKey);

    // Compute MD5 synchronously (no need to parallelize a sync operation)
    const md5 = createHash("md5").update(buffer).digest("hex");
    const durationMs = await getAudioDurationMs(buffer, contentType);

    // Reject files where the audio metadata parser could not detect a
    // valid stream. Duration 0 means no readable audio data — the
    // underlying parse error (if any) is logged inside the helper.
    if (durationMs === 0) {
        throw new AppError(
            ErrorCode.INVALID_FILE_FORMAT,
            "File does not contain a valid audio stream",
            422,
        );
    }

    const storage = await createUserStorageProvider(session.user.id);
    await storage.uploadFile(storageKey, buffer, contentType);

    const basename = path.basename(file.name, ext);
    const now = new Date();
    const endTime = new Date(now.getTime() + durationMs);

    try {
        await db.insert(recordings).values({
            userId: session.user.id,
            deviceSn: "local",
            plaudFileId: fileId,
            // Filename can carry topic info ("Call w/ Acme legal");
            // encrypt at rest. The response below returns plaintext.
            filename: encryptText(basename),
            duration: durationMs,
            startTime: now,
            endTime,
            filesize: buffer.length,
            fileMd5: md5,
            storageType: env.DEFAULT_STORAGE_TYPE,
            storagePath: storageKey,
            downloadedAt: now,
            plaudVersion: "1",
            isTrash: false,
        });
    } catch (dbError) {
        await deleteStorageObjectOrQueue(
            storage,
            storageKey,
            "recording_cleanup",
        );
        throw dbError;
    }

    await captureServerEvent({
        distinctId: session.user.id,
        event: "recording_uploaded",
        properties: {
            duration_ms: durationMs,
            filesize_bytes: buffer.length,
            extension: ext,
        },
    });

    return NextResponse.json({ success: true, filename: basename });
});
