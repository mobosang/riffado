import { gunzipSync } from "node:zlib";
import { AppError, ErrorCode } from "@/lib/errors";
import type {
    PlaudApiError,
    PlaudDeviceListResponse,
    PlaudFileDetailResponse,
    PlaudRecordingsResponse,
    PlaudTempUrlResponse,
} from "@/types/plaud";
import { plaudFetch } from "./fetch";
import { safeParseJson } from "./parse";
import { DEFAULT_SERVER_KEY, PLAUD_SERVERS, PLAUD_USER_AGENT } from "./servers";
import {
    parseV4,
    usableV4Object,
    type V4Detail,
    type V4Item,
    v4Content,
    v4ContentUrlsSchema,
    v4DetailSchema,
    v4ListSchema,
    v4Recording,
} from "./v4";
import { resolveWorkspaceToken } from "./workspace";

export interface PlaudUpdateFilenameResponse {
    status: number;
    msg: string;
    data_file?: unknown;
}

export const DEFAULT_PLAUD_API_BASE = PLAUD_SERVERS[DEFAULT_SERVER_KEY].apiBase;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function plaudHttpError(status: number, msg: string): AppError {
    if (status === 401) {
        return new AppError(
            ErrorCode.PLAUD_INVALID_TOKEN,
            "Plaud rejected the access token. Reconnect your Plaud account.",
            401,
            { plaudStatus: status, plaudMessage: msg },
        );
    }
    if (status >= 500) {
        return new AppError(
            ErrorCode.PLAUD_UPSTREAM_ERROR,
            "Plaud is temporarily unavailable. Please try again later.",
            502,
            { plaudStatus: status, plaudMessage: msg },
        );
    }
    return new AppError(ErrorCode.PLAUD_API_ERROR, msg, 400, {
        plaudStatus: status,
    });
}

export class PlaudClient {
    private readonly userToken: string;
    private readonly apiBase: string;
    private workspaceToken?: string;
    private resolvedWorkspaceId?: string;
    private workspaceFetchInFlight?: Promise<void>;
    private workspaceFallbackToUt = false;
    private useV4 = false;
    private readonly v4Lists = new Map<
        string,
        {
            items: V4Item[];
            cursor?: string;
            done: boolean;
            cursors: Set<string>;
        }
    >();

    constructor(
        userToken: string,
        apiBase: string = DEFAULT_PLAUD_API_BASE,
        workspaceId?: string | null,
    ) {
        this.userToken = userToken;
        this.apiBase = apiBase;
        this.resolvedWorkspaceId = workspaceId ?? undefined;
    }

    get workspaceId(): string | undefined {
        return this.resolvedWorkspaceId;
    }

    get usingUserTokenFallback(): boolean {
        return this.workspaceFallbackToUt;
    }

    private async ensureWorkspaceToken(): Promise<void> {
        if (this.workspaceToken || this.workspaceFallbackToUt) return;
        if (!this.workspaceFetchInFlight) {
            this.workspaceFetchInFlight = this.fetchWorkspaceToken();
        }
        try {
            await this.workspaceFetchInFlight;
        } finally {
            this.workspaceFetchInFlight = undefined;
        }
    }

    private async fetchWorkspaceToken(): Promise<void> {
        try {
            const { workspaceToken, workspaceId } = await resolveWorkspaceToken(
                this.userToken,
                this.apiBase,
                this.resolvedWorkspaceId,
            );
            this.workspaceToken = workspaceToken;
            this.resolvedWorkspaceId = workspaceId;
        } catch (err) {
            console.warn(
                "[plaud] workspace token mint failed, falling back to user token:",
                err instanceof Error ? err.message : err,
            );
            this.workspaceFallbackToUt = true;
        }
    }

    private async request<T>(
        endpoint: string,
        options?: RequestInit,
        retryCount = 0,
    ): Promise<T> {
        await this.ensureWorkspaceToken();

        const bearer = this.workspaceToken ?? this.userToken;
        const url = `${this.apiBase}${endpoint}`;

        try {
            const response = await plaudFetch(url, {
                ...options,
                headers: {
                    ...options?.headers,
                    Authorization: `Bearer ${bearer}`,
                    "Content-Type": "application/json",
                    "User-Agent": PLAUD_USER_AGENT,
                },
            });

            if (response.status === 429) {
                if (retryCount < MAX_RETRIES) {
                    const retryAfter = response.headers.get("Retry-After");
                    const delay = retryAfter
                        ? Number.parseInt(retryAfter, 10) * 1000
                        : INITIAL_RETRY_DELAY * 2 ** retryCount;
                    await sleep(delay);
                    return this.request<T>(endpoint, options, retryCount + 1);
                }
                const retryAfter = response.headers.get("Retry-After");
                throw new AppError(
                    ErrorCode.PLAUD_RATE_LIMITED,
                    "Too many requests to Plaud. Please try again later.",
                    429,
                    retryAfter
                        ? { retryAfter: Number.parseInt(retryAfter, 10) }
                        : undefined,
                );
            }

            if (!response.ok) {
                const error = (await response
                    .json()
                    .catch(() => ({}) as PlaudApiError)) as PlaudApiError;
                const upstreamMsg = error.msg || response.statusText;

                if (
                    response.status >= 500 &&
                    response.status < 600 &&
                    retryCount < MAX_RETRIES
                ) {
                    const delay = INITIAL_RETRY_DELAY * 2 ** retryCount;
                    await sleep(delay);
                    return this.request<T>(endpoint, options, retryCount + 1);
                }

                throw plaudHttpError(response.status, upstreamMsg);
            }

            const body = await safeParseJson<T>(response);
            if (body && typeof body === "object") {
                const envelope = body as Record<string, unknown>;
                const status = envelope.status ?? envelope.code;
                if (typeof status === "number" && status !== 0) {
                    throw new AppError(
                        ErrorCode.PLAUD_API_ERROR,
                        `Plaud rejected the request (status ${status}).`,
                        400,
                        { plaudStatus: status },
                    );
                }
            }
            return body;
        } catch (error) {
            if (
                error instanceof TypeError &&
                error.message.includes("fetch") &&
                retryCount < MAX_RETRIES
            ) {
                const delay = INITIAL_RETRY_DELAY * 2 ** retryCount;
                await sleep(delay);
                return this.request<T>(endpoint, options, retryCount + 1);
            }

            if (error instanceof AppError) throw error;
            throw new AppError(
                ErrorCode.PLAUD_UPSTREAM_ERROR,
                "Failed to communicate with Plaud. Please try again later.",
                502,
            );
        }
    }

    /**
     * Fetch the device list. Validates the response shape before returning:
     * a 200 with a non-zero `status` (or missing/malformed `data_devices`) is
     * a business-level Plaud error, not a schema `PlaudDeviceListResponse`
     * guarantees -- callers that iterate `data_devices` without this check
     * crash on an undefined array (issue #231). Surfaces as a typed,
     * actionable `PLAUD_API_ERROR` instead.
     */
    async listDevices(): Promise<PlaudDeviceListResponse> {
        const body =
            await this.request<PlaudDeviceListResponse>("/device/list");
        if (body?.status !== 0 || !Array.isArray(body.data_devices)) {
            throw new AppError(
                ErrorCode.PLAUD_API_ERROR,
                body?.msg ||
                    "Plaud returned an invalid device list response. Reconnect your Plaud account and try again.",
                400,
                { plaudStatus: body?.status },
            );
        }
        return body;
    }

    async getRecordings(
        skip: number = 0,
        limit: number = 99999,
        isTrash: number = 0,
        sortBy: string = "edit_time",
        isDesc: boolean = true,
    ): Promise<PlaudRecordingsResponse> {
        if (this.useV4)
            return this.getV4Recordings(skip, limit, isTrash, sortBy, isDesc);
        const params = new URLSearchParams({
            skip: skip.toString(),
            limit: limit.toString(),
            is_trash: isTrash.toString(),
            sort_by: sortBy,
            is_desc: isDesc.toString(),
        });

        try {
            const body = await this.request<PlaudRecordingsResponse>(
                `/file/simple/web?${params.toString()}`,
            );
            if (body?.status !== 0 || !Array.isArray(body.data_file_list))
                throw new AppError(
                    ErrorCode.PLAUD_UPSTREAM_ERROR,
                    "Plaud returned an invalid recording list.",
                    502,
                );
            return body;
        } catch (error) {
            this.detectV4(error);
            return this.getV4Recordings(skip, limit, isTrash, sortBy, isDesc);
        }
    }

    private detectV4(error: unknown): void {
        if (
            !(error instanceof AppError) ||
            error.details?.plaudStatus !== -1800907
        )
            throw error;
        this.useV4 = true;
    }

    private async getV4Detail(fileId: string): Promise<V4Detail> {
        const body = await this.request<unknown>(
            `/file-app/v4/files/detail/${encodeURIComponent(fileId)}`,
        );
        const detail = parseV4(v4DetailSchema, body).data;
        if (detail.meta.file_id !== fileId)
            throw new AppError(
                ErrorCode.PLAUD_UPSTREAM_ERROR,
                "Plaud returned mismatched file metadata.",
                502,
            );
        const missing = detail.objects.filter(
            (object) => !object.content_url && object.content_id,
        );
        if (missing.length) {
            const response = parseV4(
                v4ContentUrlsSchema,
                await this.request<unknown>("/file-app/v4/files/content/url", {
                    method: "POST",
                    body: JSON.stringify({
                        content_ids: missing.map((object) => object.content_id),
                    }),
                }),
            );
            for (const object of missing)
                object.content_url =
                    response.data?.url_map?.[object.content_id ?? ""];
        }
        return detail;
    }

    private async getV4Recordings(
        skip: number,
        limit: number,
        isTrash: number,
        sortBy: string,
        isDesc: boolean,
    ): Promise<PlaudRecordingsResponse> {
        if (isTrash !== 0)
            throw new AppError(
                ErrorCode.PLAUD_API_ERROR,
                "Listing trashed Plaud v4 recordings is not supported.",
                400,
            );
        const sort =
            sortBy === "edit_time"
                ? "updated"
                : sortBy === "start_time" || sortBy === "create_time"
                  ? "created"
                  : sortBy === "filename"
                    ? "name"
                    : undefined;
        if (
            !sort ||
            !Number.isSafeInteger(skip) ||
            skip < 0 ||
            !Number.isSafeInteger(limit) ||
            limit < 1
        )
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "Invalid Plaud recording pagination or sort.",
                400,
            );
        const key = `${sort}:${isDesc}`;
        if (skip === 0) this.v4Lists.delete(key);
        const state = this.v4Lists.get(key) ?? {
            items: [],
            done: false,
            cursors: new Set<string>(),
        };
        this.v4Lists.set(key, state);
        let pages = 0;
        while (!state.done && state.items.length < skip + limit) {
            if (++pages > 200)
                throw new AppError(
                    ErrorCode.PLAUD_UPSTREAM_ERROR,
                    "Plaud v4 pagination exceeded the safety limit.",
                    502,
                );
            const params = new URLSearchParams({
                page_size: "50",
                sort_by: sort,
                sort_order: isDesc ? "desc" : "asc",
            });
            if (state.cursor) params.set("cursor", state.cursor);
            const page = parseV4(
                v4ListSchema,
                await this.request<unknown>(
                    `/file-app/v4/recordings/all?${params}`,
                ),
            ).data;
            const next = page.next_cursor || undefined;
            if (next && state.cursors.has(next))
                throw new AppError(
                    ErrorCode.PLAUD_UPSTREAM_ERROR,
                    "Plaud v4 repeated a pagination cursor.",
                    502,
                );
            const known = new Set(state.items.map((item) => item.file_id));
            for (const item of page.items)
                if (!known.has(item.file_id)) {
                    state.items.push(item);
                    known.add(item.file_id);
                }
            if (next) state.cursors.add(next);
            state.cursor = next;
            state.done = !next;
        }
        const items = state.items.slice(skip, skip + limit);
        const recordings = [];
        for (let index = 0; index < items.length; index += 5) {
            recordings.push(
                ...(await Promise.all(
                    items
                        .slice(index, index + 5)
                        .map(async (item) =>
                            v4Recording(
                                item,
                                await this.getV4Detail(item.file_id),
                            ),
                        ),
                )),
            );
        }
        return {
            status: 0,
            msg: "success",
            ...(state.done ? { data_file_total: state.items.length } : {}),
            data_file_list: recordings,
        };
    }

    async getTempUrl(
        fileId: string,
        isOpus: boolean = true,
    ): Promise<PlaudTempUrlResponse> {
        if (this.useV4) return this.getV4TempUrl(fileId);
        const params = new URLSearchParams({
            is_opus: isOpus ? "1" : "0",
        });

        try {
            return await this.request<PlaudTempUrlResponse>(
                `/file/temp-url/${fileId}?${params.toString()}`,
            );
        } catch (error) {
            this.detectV4(error);
            return this.getV4TempUrl(fileId);
        }
    }

    private async getV4TempUrl(fileId: string): Promise<PlaudTempUrlResponse> {
        const detail = await this.getV4Detail(fileId);
        const audio = detail.objects.find(
            (object) =>
                object.object_type === "AUDIO" && usableV4Object(object),
        );
        if (!audio?.content_url)
            throw new AppError(
                ErrorCode.PLAUD_UPSTREAM_ERROR,
                "Plaud v4 recording audio is not available yet.",
                502,
            );
        return { status: 0, temp_url: audio.content_url };
    }

    async downloadRecording(
        fileId: string,
        preferOpus: boolean = true,
    ): Promise<Buffer> {
        try {
            const tempUrlResponse = await this.getTempUrl(fileId, preferOpus);
            const downloadUrl =
                preferOpus && tempUrlResponse.temp_url_opus
                    ? tempUrlResponse.temp_url_opus
                    : tempUrlResponse.temp_url;

            const response = await plaudFetch(downloadUrl);
            if (!response.ok) {
                throw new AppError(
                    ErrorCode.PLAUD_UPSTREAM_ERROR,
                    "Failed to download recording from Plaud. Please try again later.",
                    502,
                    { plaudStatus: response.status },
                );
            }

            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(
                ErrorCode.PLAUD_UPSTREAM_ERROR,
                "Failed to download recording from Plaud. Please try again later.",
                502,
            );
        }
    }

    /**
     * Fetch a recording's content manifest (`/file/detail/{id}`) — lists the
     * transcript / summary / note items Plaud has processed and the presigned
     * links to their bodies. Goes through `request`, so it inherits
     * workspace-token auth, retry/backoff, and 401 → PLAUD_INVALID_TOKEN.
     * NOTE: the response shape is unverified (see #204 / Phase 0).
     */
    async getFileDetail(fileId: string): Promise<PlaudFileDetailResponse> {
        if (this.useV4) return v4Content(await this.getV4Detail(fileId));
        try {
            return await this.request<PlaudFileDetailResponse>(
                `/file/detail/${encodeURIComponent(fileId)}`,
            );
        } catch (error) {
            this.detectV4(error);
            return v4Content(await this.getV4Detail(fileId));
        }
    }

    /**
     * Fetch a presigned content link (transcript / summary JSON) from S3.
     * Unlike Plaud API calls this carries no auth header and is gzip-aware:
     * undici inflates transparently when `Content-Encoding: gzip` is present,
     * otherwise we detect the gzip magic bytes and inflate manually. Returns
     * parsed JSON, or the raw string when the body isn't JSON (parsers
     * tolerate both). A 403 here means an expired presign (skip this item) —
     * distinct from a dead Plaud token (401 from `getFileDetail`).
     */
    async fetchContentLink(url: string): Promise<unknown> {
        const response = await plaudFetch(url);
        if (!response.ok) {
            throw new AppError(
                ErrorCode.PLAUD_UPSTREAM_ERROR,
                "Failed to fetch Plaud content link.",
                502,
                { plaudStatus: response.status },
            );
        }

        const arrayBuffer = await response.arrayBuffer();
        let buf = Buffer.from(arrayBuffer);
        if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
            buf = gunzipSync(buf);
        }

        const text = buf.toString("utf-8");
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }

    async testConnection(): Promise<boolean> {
        try {
            await this.listDevices();
            return true;
        } catch {
            return false;
        }
    }

    async updateFilename(
        fileId: string,
        filename: string,
    ): Promise<PlaudUpdateFilenameResponse> {
        return this.request<PlaudUpdateFilenameResponse>(`/file/${fileId}`, {
            method: "PATCH",
            body: JSON.stringify({ filename }),
        });
    }
}

export * from "./types";
