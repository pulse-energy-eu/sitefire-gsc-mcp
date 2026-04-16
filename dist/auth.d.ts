/**
 * OAuth 2.0 Installed App Flow for Google Search Console.
 *
 * First run: opens browser for consent, catches redirect on localhost,
 * persists refresh token to ~/.sitefire-gsc/token.json.
 *
 * Subsequent runs: loads persisted token, auto-refreshes access token.
 */
import { OAuth2Client } from "google-auth-library";
export interface AuthState {
    status: "valid" | "missing" | "invalid" | "error";
    message: string;
}
export declare function getTokenPath(): string;
export declare function tokenExists(): boolean;
export declare function deleteToken(): void;
/**
 * Get an authenticated OAuth2 client. If no token exists, triggers
 * the browser-based consent flow (local loopback redirect).
 */
export declare function getAuthClient(): Promise<OAuth2Client>;
/**
 * Validate the current token by attempting a lightweight API call.
 * Returns auth state without triggering a consent flow.
 */
export declare function checkAuth(): Promise<AuthState>;
//# sourceMappingURL=auth.d.ts.map