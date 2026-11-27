import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { TranscriptOption } from "@/components/dashboard/transcription-panel";
import { Workstation } from "@/components/dashboard/workstation";
import { db } from "@/db";
import {
    aiEnhancements,
    plaudConnections,
    recordings,
    transcriptions,
    userSettings,
} from "@/db/schema";
import { requireAuth } from "@/lib/auth-server";
import { decryptText } from "@/lib/encryption/fields";
import { env } from "@/lib/env";
import { isAdminEmail } from "@/lib/hosted/admin/guard";
import { initialSettingsFromRow } from "@/lib/settings/initial-settings";
import { resolvePrimaryTranscript } from "@/lib/v1/serialize";
import { serializeRecording } from "@/types/recording";

export default async function DashboardPage() {
    const session = await requireAuth();

    const [
        userRecordings,
        userTranscriptions,
        userSummaryRows,
        [settingsRow],
        [connectionRow],
    ] = await Promise.all([
        db
            .select({
                id: recordings.id,
                filename: recordings.filename,
                duration: recordings.duration,
                startTime: recordings.startTime,
                filesize: recordings.filesize,
                deviceSn: recordings.deviceSn,
                waveformPeaks: recordings.waveformPeaks,
                transcriptionError: recordings.transcriptionError,
            })
            .from(recordings)
            .where(
                and(
                    eq(recordings.userId, session.user.id),
                    isNull(recordings.deletedAt),
                ),
            )
            .orderBy(desc(recordings.startTime)),
        db
            .select({
                recordingId: transcriptions.recordingId,
                source: transcriptions.source,
                text: transcriptions.text,
                language: transcriptions.detectedLanguage,
            })
            .from(transcriptions)
            .where(eq(transcriptions.userId, session.user.id)),
        // We only need to know IF a summary exists per recording for the
        // list status chip — the full summary is still fetched on
        // selection by the existing /api/recordings/[id]/summary route.
        db
            .select({ recordingId: aiEnhancements.recordingId })
            .from(aiEnhancements)
            .where(
                and(
                    eq(aiEnhancements.userId, session.user.id),
                    isNotNull(aiEnhancements.summary),
                ),
            ),
        // Load user settings server-side so the Workstation, list, and
        // player render with the user's preferences on first paint — no
        // waterfall of /api/settings/user fetches from three different
        // components.
        db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, session.user.id))
            .limit(1),
        db
            .select({
                invalidatedAt: plaudConnections.invalidatedAt,
                sessionExpiresAt: plaudConnections.sessionExpiresAt,
            })
            .from(plaudConnections)
            .where(eq(plaudConnections.userId, session.user.id))
            .limit(1),
    ]);
    const summaryIds = new Set(userSummaryRows.map((r) => r.recordingId));
    const transcriptIds = new Set(userTranscriptions.map((t) => t.recordingId));

    // Content fields are encrypted at rest; decrypt server-side (this is
    // an RSC — client never sees a key) before serializing for the
    // workstation. Legacy plaintext rows pass through verbatim.
    const recordingsData = userRecordings.map(({ waveformPeaks, ...r }) =>
        serializeRecording(
            { ...r, filename: decryptText(r.filename) },
            {
                hasTranscript: transcriptIds.has(r.id),
                hasSummary: summaryIds.has(r.id),
                // jsonb comes back already-parsed; coerce to the typed shape.
                waveformPeaks: Array.isArray(waveformPeaks)
                    ? (waveformPeaks as number[])
                    : null,
            },
        ),
    );

    const transcriptionMap = new Map<string, TranscriptOption[]>();
    for (const row of userTranscriptions) {
        const options = transcriptionMap.get(row.recordingId) ?? [];
        options.push({
            source: row.source,
            text: decryptText(row.text),
            language: row.language || undefined,
        });
        transcriptionMap.set(row.recordingId, options);
    }
    const preferredSource = settingsRow?.preferredTranscriptSource ?? "plaud";
    for (const [id, options] of transcriptionMap) {
        const primary = resolvePrimaryTranscript(options, preferredSource);
        if (primary && options[0] !== primary) {
            transcriptionMap.set(id, [
                primary,
                ...options.filter((option) => option !== primary),
            ]);
        }
    }

    // One source of truth for InitialSettings + their defaults lives in
    // `src/lib/settings/initial-settings.ts`; adding a new preference
    // there is the only place callers need to touch.
    const initialSettings = initialSettingsFromRow(settingsRow);

    return (
        <Workstation
            recordings={recordingsData}
            transcriptions={transcriptionMap}
            isAdmin={isAdminEmail(session.user.email)}
            userEmail={session.user.email ?? null}
            initialSettings={initialSettings}
            plaudNeedsReconnect={connectionRow?.invalidatedAt != null}
            plaudSessionExpiresAt={
                connectionRow?.sessionExpiresAt?.toISOString() ?? null
            }
            isHosted={env.IS_HOSTED}
        />
    );
}
