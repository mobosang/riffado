export async function readVoiceprintJson(
    message: Request | Response,
    maxBytes: number,
): Promise<unknown> {
    const reader = message.body?.getReader();
    if (!reader) return null;

    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > maxBytes) {
                await reader.cancel();
                return null;
            }
            chunks.push(value);
        }
        return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
    } catch {
        return null;
    } finally {
        reader.releaseLock();
    }
}
