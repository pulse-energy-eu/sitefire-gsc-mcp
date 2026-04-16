/**
 * Error translation layer.
 *
 * Maps raw Google API errors to user-facing messages with concrete
 * next actions. Every error surfaced to the MCP user goes through
 * translateError().
 */
export declare class GscApiError extends Error {
    readonly code: string;
    readonly userMessage: string;
    readonly httpStatus?: number | undefined;
    readonly raw?: unknown | undefined;
    constructor(code: string, userMessage: string, httpStatus?: number | undefined, raw?: unknown | undefined);
}
export declare class ReauthRequired extends GscApiError {
    constructor(detail?: string);
}
/**
 * Translate a raw error (from googleapis or network) into a GscApiError
 * with a user-facing message and concrete next action.
 */
export declare function translateError(err: unknown, context?: {
    siteUrl?: string;
    url?: string;
}): GscApiError;
//# sourceMappingURL=gsc-errors.d.ts.map