/**
 * OAuth 2.0 Installed App Flow for Google Search Console.
 *
 * First run: opens browser for consent, catches redirect on localhost,
 * persists refresh token to ~/.sitefire-gsc/token.json.
 *
 * Subsequent runs: loads persisted token, auto-refreshes access token.
 */
import { OAuth2Client } from "google-auth-library";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import * as url from "node:url";
const SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"];
const TOKEN_DIR = path.join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".sitefire-gsc");
const TOKEN_PATH = path.join(TOKEN_DIR, "token.json");
// Baked-in OAuth client credentials (public client for installed app flow).
// These are NOT secrets: Google's installed-app OAuth model expects them
// distributed with the binary. The security boundary is the user's browser
// consent, not the client_id.
const CLIENT_ID = process.env.SITEFIRE_GSC_CLIENT_ID ??
    "727930320778-6slogb932botu9q4dfngll7aghl567l4.apps.googleusercontent.com";
const CLIENT_SECRET = process.env.SITEFIRE_GSC_CLIENT_SECRET ?? "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";
export function getTokenPath() {
    return TOKEN_PATH;
}
export function tokenExists() {
    return fs.existsSync(TOKEN_PATH);
}
function ensureTokenDir() {
    if (!fs.existsSync(TOKEN_DIR)) {
        fs.mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
    }
}
function loadToken() {
    if (!fs.existsSync(TOKEN_PATH))
        return null;
    try {
        const raw = fs.readFileSync(TOKEN_PATH, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function saveToken(token) {
    ensureTokenDir();
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2), { mode: 0o600 });
}
export function deleteToken() {
    if (fs.existsSync(TOKEN_PATH)) {
        fs.unlinkSync(TOKEN_PATH);
    }
}
function createOAuth2Client(redirectUri) {
    return new OAuth2Client(CLIENT_ID, CLIENT_SECRET, redirectUri);
}
/**
 * Get an authenticated OAuth2 client. If no token exists, triggers
 * the browser-based consent flow (local loopback redirect).
 */
export async function getAuthClient() {
    const token = loadToken();
    if (token) {
        const client = createOAuth2Client();
        client.setCredentials(token);
        // Auto-refresh: google-auth-library handles this if refresh_token is set.
        // Listen for new tokens so we persist them.
        client.on("tokens", (newTokens) => {
            const merged = { ...token, ...newTokens };
            saveToken(merged);
        });
        return client;
    }
    // No token: run the installed app flow
    return runInstalledAppFlow();
}
/**
 * Validate the current token by attempting a lightweight API call.
 * Returns auth state without triggering a consent flow.
 */
export async function checkAuth() {
    const token = loadToken();
    if (!token) {
        return {
            status: "missing",
            message: "No Google authorization yet. Invoke any tool to start the OAuth flow, or run setup_check.",
        };
    }
    const client = createOAuth2Client();
    client.setCredentials(token);
    try {
        // Force a token refresh to validate
        const { token: accessToken } = await client.getAccessToken();
        if (!accessToken) {
            deleteToken();
            return {
                status: "invalid",
                message: "Your Google authorization was revoked or expired. Run setup_check to re-authenticate.",
            };
        }
        return { status: "valid", message: "Google authorization is valid." };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("invalid_grant") || message.includes("Token has been expired or revoked")) {
            deleteToken();
            return {
                status: "invalid",
                message: "Your Google authorization was revoked or expired. Run setup_check to re-authenticate.",
            };
        }
        return {
            status: "error",
            message: `Could not validate authorization: ${message}`,
        };
    }
}
/**
 * Run the OAuth Installed App Flow:
 * 1. Start a local HTTP server on a random port
 * 2. Open the user's browser to Google's consent URL
 * 3. Catch the redirect with the auth code
 * 4. Exchange for tokens, persist, return client
 */
async function runInstalledAppFlow() {
    return new Promise((resolve, reject) => {
        const server = http.createServer();
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            if (!addr || typeof addr === "string") {
                server.close();
                reject(new Error("Failed to start local OAuth redirect server."));
                return;
            }
            const port = addr.port;
            const redirectUri = `http://127.0.0.1:${port}`;
            const client = createOAuth2Client(redirectUri);
            const authUrl = client.generateAuthUrl({
                access_type: "offline",
                scope: SCOPES,
                prompt: "consent",
            });
            // Print the URL for the user (and try to open browser)
            process.stderr.write(`\nOpen this URL in your browser to authorize sitefire-gsc-mcp:\n${authUrl}\n\n`);
            openBrowser(authUrl);
            // 30-second timeout
            const timeout = setTimeout(() => {
                server.close();
                reject(new Error("OAuth flow did not complete within 30 seconds. Re-run setup_check to retry."));
            }, 30_000);
            server.on("request", async (req, res) => {
                try {
                    const parsed = url.parse(req.url ?? "", true);
                    const code = parsed.query.code;
                    const error = parsed.query.error;
                    if (error) {
                        res.writeHead(200, { "Content-Type": "text/html" });
                        res.end("<html><body><h2>Authorization denied.</h2><p>You can close this tab.</p></body></html>");
                        clearTimeout(timeout);
                        server.close();
                        reject(new Error(`OAuth consent denied: ${error}`));
                        return;
                    }
                    if (!code) {
                        res.writeHead(400, { "Content-Type": "text/plain" });
                        res.end("Missing authorization code.");
                        return;
                    }
                    const { tokens } = await client.getToken(code);
                    client.setCredentials(tokens);
                    saveToken(tokens);
                    // Listen for future refreshes
                    client.on("tokens", (newTokens) => {
                        const merged = { ...tokens, ...newTokens };
                        saveToken(merged);
                    });
                    res.writeHead(200, { "Content-Type": "text/html" });
                    res.end("<html><body><h2>Authorization successful!</h2><p>You can close this tab and return to Claude.</p></body></html>");
                    clearTimeout(timeout);
                    server.close();
                    resolve(client);
                }
                catch (err) {
                    res.writeHead(500, { "Content-Type": "text/plain" });
                    res.end("Token exchange failed.");
                    clearTimeout(timeout);
                    server.close();
                    reject(err);
                }
            });
        });
    });
}
function openBrowser(targetUrl) {
    try {
        const platform = process.platform;
        if (platform === "darwin") {
            execSync(`open "${targetUrl}"`);
        }
        else if (platform === "win32") {
            execSync(`start "${targetUrl}"`);
        }
        else {
            execSync(`xdg-open "${targetUrl}"`);
        }
    }
    catch {
        // Silently fail - the URL is already printed to stderr
    }
}
//# sourceMappingURL=auth.js.map