/**
 * Error translation layer.
 *
 * Maps raw Google API errors to user-facing messages with concrete
 * next actions. Every error surfaced to the MCP user goes through
 * translateError().
 */
export class GscApiError extends Error {
    code;
    userMessage;
    httpStatus;
    raw;
    constructor(code, userMessage, httpStatus, raw) {
        super(userMessage);
        this.code = code;
        this.userMessage = userMessage;
        this.httpStatus = httpStatus;
        this.raw = raw;
        this.name = "GscApiError";
    }
}
export class ReauthRequired extends GscApiError {
    constructor(detail) {
        super("REAUTH_REQUIRED", "Your Google authorization was revoked or expired. Run setup_check to re-authenticate.", 401, detail);
        this.name = "ReauthRequired";
    }
}
/**
 * Translate a raw error (from googleapis or network) into a GscApiError
 * with a user-facing message and concrete next action.
 */
export function translateError(err, context) {
    // Already translated
    if (err instanceof GscApiError)
        return err;
    // googleapis wraps HTTP errors with a .code and .errors property
    const gaxErr = err;
    const httpStatus = gaxErr.code ?? gaxErr.response?.status;
    const message = gaxErr.message ?? "";
    const reason = gaxErr.errors?.[0]?.reason ?? "";
    // 401 / invalid_grant: token expired or revoked
    if (httpStatus === 401 ||
        message.includes("invalid_grant") ||
        message.includes("Token has been expired or revoked")) {
        return new ReauthRequired(message);
    }
    // 403 PERMISSION_DENIED
    if (httpStatus === 403) {
        if (reason === "forbidden" ||
            message.includes("does not have sufficient permission") ||
            message.includes("User does not have sufficient permission")) {
            const siteHint = context?.siteUrl ? ` \`${context.siteUrl}\`` : "";
            return new GscApiError("PERMISSION_DENIED", `You don't have access to${siteHint}. Run list_my_properties to see what you do have, or sign in with a different Google account.`, 403, message);
        }
        if (message.includes("insufficientPermissions") || reason === "insufficientPermissions") {
            return new GscApiError("INSUFFICIENT_SCOPE", "This action requires more access than you granted. v0 is read-only; upgrade coming soon.", 403, message);
        }
        // Generic 403
        return new GscApiError("PERMISSION_DENIED", `Access denied. Run list_my_properties to see your accessible properties.`, 403, message);
    }
    // 429 rate limit
    if (httpStatus === 429) {
        const retryAfter = gaxErr.response?.headers?.["retry-after"];
        let retryHint = "Try again in a minute or tomorrow.";
        if (retryAfter) {
            const seconds = parseInt(retryAfter, 10);
            if (!isNaN(seconds)) {
                retryHint = seconds >= 60
                    ? `Try again in about ${Math.ceil(seconds / 60)} minutes.`
                    : `Try again in ${seconds} seconds.`;
            }
            else {
                retryHint = `Try again after ${retryAfter}.`;
            }
        }
        return new GscApiError("RATE_LIMITED", `Google's rate limit for this site has been hit. ${retryHint}`, 429, message);
    }
    // 400 bad argument (property format, date range, etc.)
    if (httpStatus === 400) {
        const siteHint = context?.siteUrl ? ` \`${context.siteUrl}\`` : "";
        return new GscApiError("INVALID_ARGUMENT", `The property${siteHint} isn't in the right format. Run list_my_properties to see the exact strings Google uses.`, 400, message);
    }
    // 404 not found
    if (httpStatus === 404) {
        return new GscApiError("NOT_FOUND", "No such property in this Google account. Run list_my_properties.", 404, message);
    }
    // 5xx server errors
    if (httpStatus && httpStatus >= 500) {
        return new GscApiError("SERVER_ERROR", "Google is temporarily unavailable. Try again in a moment.", httpStatus, message);
    }
    // Network / timeout errors
    if (err instanceof Error) {
        if (message.includes("ENOTFOUND") ||
            message.includes("ECONNREFUSED") ||
            message.includes("ETIMEDOUT") ||
            message.includes("network") ||
            message.includes("fetch failed")) {
            return new GscApiError("NETWORK_ERROR", "Couldn't reach Google. Check your internet connection.", undefined, message);
        }
        if (message.includes("timeout") || message.includes("TIMEOUT")) {
            return new GscApiError("TIMEOUT", "Couldn't reach Google. Check your internet connection.", undefined, message);
        }
    }
    // Unknown error: surface the raw message
    const fallbackMsg = err instanceof Error ? err.message : String(err);
    return new GscApiError("UNKNOWN", `Unexpected error: ${fallbackMsg}`, httpStatus, err);
}
//# sourceMappingURL=gsc-errors.js.map