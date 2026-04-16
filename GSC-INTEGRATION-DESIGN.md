# GSC Tools Integration into sitefire MCP - Design Doc

**Status:** Ready to implement. Tool code built and tested (101 tests passing in sitefire-gsc-mcp repo). This doc covers porting into pulse-geo.
**Date:** 2026-04-16.
**Reviewed by:** Codex (adversarial review, 12 findings, all addressed below).
**Companion doc:** The multi-provider connect page, entitlement model, and auth architecture are documented in the Bing MCP DESIGN.md (Phase 1 section). This doc covers GSC-specific concerns only.

## TL;DR

Port the 7 Google Search Console tools from `sitefire-gsc-mcp` into the production sitefire MCP at `pulse-geo/routes/api/mcp.ts`. GSC tools are conditionally loaded when a user has connected their Google account via the multi-provider connect page. Same pattern as Bing tools, but with Google OAuth instead of an API key paste.

GSC is the second free data source in the lead-magnet funnel. Every SEO professional has GSC configured. Together with Bing, sitefire owns both halves of the search visibility story: Google (traditional SEO) and Bing-powered assistants (ChatGPT Search, Copilot, Perplexity).

## What already exists

### sitefire-gsc-mcp repo (complete, v0 shipped)

- **7 composite tools**, each answering an outcome question (not wrapping an endpoint)
- **101 unit tests** covering all error paths, edge cases, and partial failures
- **Hardened:** startup 3s timeout, OAuth state validation, auth singleton, 429 Retry-After extraction
- **Error translation layer** mapping all Google API error patterns to user-facing messages
- **GscClient class** that takes an `OAuth2Client` in its constructor (already decoupled from auth)
- **Fixtures:** 7 live (sitefire.ai) + 7 synthetic edge cases

### Production sitefire MCP (pulse-geo, already live)

- Bing tools already integrated with entitlement gating
- `bing_credentials` table with per-user API key storage
- `createMcpServer()` conditionally registers Bing tools based on credential lookup
- PostHog tracking and structured logging on every tool call

## The seven GSC tools

| Tool | Answers | Underlying GSC API calls |
|---|---|---|
| `setup_check` | "Is everything configured correctly?" | sites.list, sitemaps.list, searchAnalytics.query |
| `list_my_properties` | "Which sites are under my Google account?" | sites.list |
| `weekly_report` | "How is my site doing on Google this week?" | searchAnalytics.query (3 variants) + sitemaps.list via Promise.allSettled |
| `inspect_url` | "What does Google know about this URL?" | urlInspection.index.inspect |
| `find_opportunities` | "What should I focus on to grow traffic?" | searchAnalytics.query (3 filter strategies) |
| `detect_cannibalization` | "Are pages competing for the same query?" | searchAnalytics.query with dimensions ["query", "page"] |
| `traffic_drop_diagnosis` | "Why did my traffic drop?" | searchAnalytics.query x2 (current + previous period) |

Each tool returns structured JSON. The model renders tables, prose, or charts. No pre-rendered markdown in tool output.

### Tool differences from Bing

| Aspect | Bing tools | GSC tools |
|---|---|---|
| Auth | API key (string, inline paste) | Google OAuth (refresh token, browser redirect) |
| Cross-site tool | `keyword_opportunity` (no site needed) | None (all tools require a property) |
| Write tool | `push_to_bing` (URL submission) | None (v0 is read-only, `webmasters.readonly` scope) |
| Rate limits | Per-key, generous | `urlInspection`: 2,000/day per property, 600/min |
| Data freshness | 48h lag | 2-3 day lag (GSC-specific, documented in tool responses) |
| Partial failures | 5 endpoints via allSettled | 4 endpoints via allSettled (weekly_report) |

## Architecture: how GSC fits into the MCP

### Current state (Bing only)

```ts
// In mcp.ts POST handler
const bingApiKey = await lookupBingKey(userId);
const server = createMcpServer(supabase, companyId, userId, logger, bingApiKey);
// Bing tools registered if bingApiKey is truthy
```

### Target state (Bing + GSC)

```ts
// In mcp.ts POST handler
const bingApiKey = await lookupBingKey(userId);
const gscAuth = await lookupGscAuth(userId);  // returns OAuth2Client or null
const server = createMcpServer(supabase, companyId, userId, logger, bingApiKey, gscAuth);
// Bing tools registered if bingApiKey is truthy
// GSC tools registered if gscAuth is truthy
```

### Auth adapter: local vs hosted

The `GscClient` class is already decoupled. It takes an `OAuth2Client` in its constructor:

```ts
// Local MCP (sitefire-gsc-mcp repo)
const auth = await getAuthClient(); // reads ~/.sitefire-gsc/token.json
const client = new GscClient(auth);

// Hosted MCP (pulse-geo)
function createGscAuthFromStored(refreshToken: string): OAuth2Client {
  const client = new OAuth2Client(
    process.env.GSC_OAUTH_CLIENT_ID,
    process.env.GSC_OAUTH_CLIENT_SECRET,
    "https://app.sitefire.ai/api/mcp/connect/gsc/callback"
  );
  client.setCredentials({ refresh_token: refreshToken });
  client.on("tokens", (newTokens) => {
    // Update stored token if Google rotates it
    updateGscCredential(userId, newTokens);
  });
  return client;
}

const auth = createGscAuthFromStored(decryptedRefreshToken);
const client = new GscClient(auth);
```

The tool functions (`weeklyReport`, `findOpportunities`, etc.) don't change. Only the OAuth2Client initialization differs.

### setup_check adaptation

The local MCP's `setup_check` takes an `AuthState` parameter that checks local token validity. In the hosted MCP, auth already happened on the connect page, so:

- Pass `{ status: "valid", message: "Google authorization is valid." }` as the AuthState
- The rest of `setup_check` (property access, sitemap status, data availability) works unchanged

If the stored refresh token is revoked between sessions, the first GSC API call will fail with `invalid_grant`. The error translation layer already maps this to: "Your Google authorization was revoked. Reconnect at app.sitefire.ai/connect." No special handling needed in the tool.

## Files to create in pulse-geo

### New files

| File | Contents | Source |
|---|---|---|
| `routes/api/_shared/gsc-client.ts` | GscClient class (googleapis wrapper, retry, typed errors) | Copy from `sitefire-gsc-mcp/src/gsc-client.ts`, remove `import { deleteToken }` |
| `routes/api/_shared/gsc-errors.ts` | translateError + GscApiError + ReauthRequired | Copy from `sitefire-gsc-mcp/src/gsc-errors.ts`, unchanged |
| `routes/api/_shared/gsc-tools.ts` | 7 tool functions | Copy from `sitefire-gsc-mcp/src/tools/*.ts`, consolidate into one file (same pattern as bing-tools.ts) |

### Modified files

| File | Change |
|---|---|
| `routes/api/mcp.ts` | Add GSC tool registration block (conditional on gsc credential), add `lookupGscAuth()`, import gsc-tools |
| `routes/api/mcp.ts` SERVER_INSTRUCTIONS | Add GSC tool workflow section (same pattern as the existing Bing section) |

### Database migration

```sql
CREATE TABLE gsc_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token_encrypted TEXT NOT NULL,
  google_email TEXT,
  properties_cache JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

-- RLS: users can only see their own credentials
ALTER TABLE gsc_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own gsc_credentials"
  ON gsc_credentials FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own gsc_credentials"
  ON gsc_credentials FOR DELETE
  USING (auth.uid() = user_id);
-- Insert and update via service role only (server-side token storage)
```

Note: This uses the existing `auth.users` table. When the multi-provider connect page ships (the Bing DESIGN.md's Phase 1), this FK will be updated to also support guest identities via `mcp_users`. For now, GSC integration ships for **existing sitefire users** first.

## Adaptation details: what changes when copying

### gsc-client.ts

One change: remove the `deleteToken` import and the local file deletion on reauth.

```diff
- import { deleteToken } from "./auth.js";
...
  private handleError(err: unknown, context?: { siteUrl?: string; url?: string }): GscApiError {
    const translated = translateError(err, context);
-   if (translated instanceof ReauthRequired) {
-     deleteToken();
-   }
    return translated;
  }
```

In the hosted MCP, reauth is handled by the error response routing the user back to the connect page, not by deleting a local file.

### gsc-tools.ts consolidation

The 7 tool files (`list-my-properties.ts`, `setup-check.ts`, `weekly-report.ts`, `inspect-url.ts`, `find-opportunities.ts`, `detect-cannibalization.ts`, `traffic-drop-diagnosis.ts`) get consolidated into a single `gsc-tools.ts` file exporting 7 named functions. Same pattern as `bing-tools.ts`.

Each function signature stays the same: takes a `GscClient` and tool-specific args, returns structured JSON.

### Error handling in mcp.ts

Same pattern as Bing tools in the existing mcp.ts:

```ts
server.tool("gsc_weekly_report", description, schema, async (args) => {
  const result = await trackedToolCall(
    { tool: "gsc_weekly_report", userId, companyId, logger, params: args },
    async () => {
      try {
        return await weeklyReport(gscClient, args.site_url);
      } catch (err) {
        if (err instanceof GscApiError) {
          return { error: err.userMessage };
        }
        throw err;
      }
    }
  );
  return toToolResult(result);
});
```

### Tool naming: prefix with `gsc_`

To avoid confusion with Bing tools that have similar names (both have `setup_check`, `inspect_url`, `weekly_report`):

| Local MCP name | Hosted MCP name |
|---|---|
| `setup_check` | `gsc_setup_check` |
| `list_my_properties` | `gsc_list_my_properties` |
| `weekly_report` | `gsc_weekly_report` |
| `inspect_url` | `gsc_inspect_url` |
| `find_opportunities` | `gsc_find_opportunities` |
| `detect_cannibalization` | `gsc_detect_cannibalization` |
| `traffic_drop_diagnosis` | `gsc_traffic_drop_diagnosis` |

Bing tools already use unprefixed names in production. Adding a `bing_` prefix to them is a separate decision (breaking change for existing users). GSC starts prefixed from day one.

## Security: Google OAuth refresh token storage

### Why this is harder than Bing

Bing uses an API key (a static string the user generates manually). Google uses OAuth refresh tokens (long-lived delegated access that can read the user's GSC data). A leaked refresh token grants read access to all of that user's GSC properties until revoked.

### Encryption design

- **Algorithm:** AES-256-GCM (authenticated encryption)
- **Key:** Stored as Vercel environment variable `GSC_TOKEN_ENCRYPTION_KEY`. Not in Supabase, not in code.
- **Per-token IV:** Unique random 12-byte IV per encrypted token, stored with the ciphertext.
- **Storage format:** `base64(iv):base64(ciphertext):base64(authTag)` in the `refresh_token_encrypted` column.
- **Decryption:** Only in the MCP server Vercel function, per-request, in-memory. Never persisted decrypted.

### What gets logged (and what doesn't)

| Data | Logged? | Where |
|---|---|---|
| Tool name + duration | Yes | PostHog `mcp_tool_call` event |
| `site_url` parameter | Yes | PostHog (user's own domain, needed for debugging) |
| GSC data (queries, URLs, impressions) | **No** | Returned to user only |
| OAuth token values | **No** | Never |
| `google_email` | Stored in DB | For reconnect UX, not in PostHog |
| Token lifecycle (grant, refresh, revoke) | Yes | Structured logs with user_id only |

### Token lifecycle

1. **Grant:** User completes Google OAuth on the connect page. Callback receives auth code, exchanges for tokens, encrypts refresh token, stores in `gsc_credentials`.
2. **Refresh:** On each GSC tool call, `google-auth-library` auto-refreshes the access token using the stored refresh token. If Google issues a new refresh token (rotation), the `tokens` event fires, and we update the stored encrypted token.
3. **Revocation by user:** User revokes at `myaccount.google.com/permissions`. Next GSC tool call returns `invalid_grant`. Error translation returns: "Your Google authorization was revoked. Reconnect at app.sitefire.ai/connect." We mark `revoked_at` on the credential.
4. **Disconnect:** User disconnects GSC from the connect page. We delete the `gsc_credentials` row and call Google's revocation endpoint to invalidate the token server-side.

### Open: hosted token refresh validation

**Must test before launch.** Deploy to staging, connect GSC, wait >1 hour for the access token to expire, call a GSC tool. Verify that `google-auth-library` on Vercel correctly refreshes the token from the stored refresh token without user interaction.

This is not validated by the local MCP (which uses a persistent process with an in-memory OAuth2Client). The hosted MCP creates a fresh OAuth2Client per request from the stored refresh token. The refresh flow must work in this stateless context.

## Quota and rate limiting

### GSC API limits

| Endpoint | Limit |
|---|---|
| `searchAnalytics.query` | No documented per-user limit, but Google throttles heavy usage |
| `urlInspection.index.inspect` | 2,000/day per property, 600/min |
| `sites.list`, `sitemaps.list` | Lightweight, no practical limit |

### Concern: URL inspection is per-property, not per-user

If multiple sitefire users have access to the same GSC property (e.g., agency team members), their `inspect_url` calls count against the same 2,000/day property quota, even though they use different OAuth tokens.

### Mitigation

- **429 Retry-After extraction:** Already implemented in `gsc-errors.ts`. When Google returns 429, the error message includes the reset time from the `Retry-After` header.
- **Per-property inspection cache (v1+):** Cache `inspect_url` results with a 1-hour TTL keyed by `(property, url)`. Not in the initial PR. Acceptable for v1 scale.
- **No request coalescing.** Serverless (stateless per request) makes this impractical. Revisit if agency usage creates problems.

## Google OAuth client: separate from local MCP

The local MCP (sitefire-gsc-mcp) uses a GCP OAuth client configured as "Desktop App" type with localhost loopback redirect. The hosted MCP needs a "Web Application" type with `app.sitefire.ai` redirect URI.

**Decision: separate OAuth clients.** Different client types, different redirect URIs, different blast radius. Both under the same GCP project (pulse-geo). Both request `webmasters.readonly` scope.

| | Local MCP | Hosted MCP |
|---|---|---|
| GCP client type | Desktop App | Web Application |
| Redirect URI | `http://127.0.0.1:{random_port}` | `https://app.sitefire.ai/api/mcp/connect/gsc/callback` |
| Client ID source | `SITEFIRE_GSC_CLIENT_ID` env var | `GSC_OAUTH_CLIENT_ID` Vercel env var |
| Token storage | `~/.sitefire-gsc/token.json` (local file) | `gsc_credentials` table (Supabase, encrypted) |

The hosted client needs its own Google OAuth verification submission (separate from the local MCP's). Non-sensitive scope (`webmasters.readonly`), so verification is lighter but still takes 2-6 weeks.

## SERVER_INSTRUCTIONS addition

Add to the existing server instructions in mcp.ts:

```
## Google Search Console (available when GSC is connected)
If the user has connected their Google Search Console account, additional tools
are available for analyzing their Google search performance.

### GSC tool workflow
1. gsc_list_my_properties - see which sites are in your Google account
2. gsc_setup_check - diagnose configuration health (auth, property access, sitemaps, data)
3. gsc_weekly_report - weekly performance with clicks/impressions/CTR/position, top queries/pages
4. gsc_inspect_url - check if a specific URL is indexed by Google
5. gsc_find_opportunities - striking distance queries, low-hanging fruit, zero-click queries
6. gsc_detect_cannibalization - find pages competing for the same Google query
7. gsc_traffic_drop_diagnosis - diagnose why Google traffic dropped

### GSC guidelines
- Always run gsc_list_my_properties or gsc_setup_check first if unsure whether
  the user has accessible properties.
- For tools that require a site_url, use one of the user's accessible properties
  (format: "sc-domain:example.com" or "https://example.com/").
- GSC data has a 2-3 day freshness lag. This is normal and documented in tool responses.
- If a GSC tool returns an error suggesting re-authentication, guide the user to
  reconnect at app.sitefire.ai/connect.
```

## Implementation checklist

### PR 1: GSC tools in production MCP (for existing sitefire users)

- [ ] Copy `gsc-client.ts` into `routes/api/_shared/` (remove deleteToken import)
- [ ] Copy `gsc-errors.ts` into `routes/api/_shared/` (unchanged)
- [ ] Consolidate 7 tool files into `routes/api/_shared/gsc-tools.ts`
- [ ] Create Supabase migration for `gsc_credentials` table with RLS
- [ ] Add `lookupGscAuth()` function in mcp.ts POST handler
- [ ] Add `createGscAuthFromStored()` helper for OAuth2Client initialization
- [ ] Register 7 `gsc_*` tools in `createMcpServer()` (conditional on gsc credential)
- [ ] Add GSC section to SERVER_INSTRUCTIONS
- [ ] Implement token refresh detection (update stored token on rotation)
- [ ] Implement revocation detection (mark revoked_at on invalid_grant)
- [ ] Add PostHog tracking for GSC tool calls (same pattern as Bing)
- [ ] Add GSC OAuth client credentials to Vercel env vars
- [ ] Add `GSC_TOKEN_ENCRYPTION_KEY` to Vercel env vars
- [ ] Implement AES-256-GCM encrypt/decrypt helpers
- [ ] Test on staging: connect GSC, run each tool, verify output matches local MCP
- [ ] Test token refresh: connect, wait >1 hour, call tool, verify auto-refresh works

### PR 2: Multi-provider connect page (enables free GSC without sitefire account)

Documented in Bing MCP DESIGN.md Phase 1 section. GSC adds:
- [ ] Google OAuth flow on the connect page (redirect to Google, callback stores tokens)
- [ ] GSC checkbox on the multi-select consent screen
- [ ] `mcp_users` / guest identity support for GSC-only free users

### Not in scope

- npm publish of local MCP (separate, in sitefire-gsc-mcp repo)
- Incremental OAuth scope upgrade to `webmasters` (v2, requires write access)
- CI smoke check against live GSC API (post-launch)
- Per-property inspection cache (v1+, if quota becomes a problem)

## References

- `sitefire-gsc-mcp/` repo - source of truth for tool implementations and tests
- `sitefire-gsc-mcp/DESIGN.md` - full v0 design doc (local MCP)
- `sitefire-gsc-mcp/V1-PLAN.md` - infrastructure decision doc (multi-entry auth model)
- Bing MCP DESIGN.md Phase 1 section - multi-provider connect page and entitlement model
- `pulse-geo/routes/api/mcp.ts` - production MCP with Bing tools already integrated
- `pulse-geo/routes/api/_shared/bing-tools.ts` - pattern to follow for GSC tools
- [Google Search Console API v3](https://developers.google.com/webmaster-tools/v1/api_reference_index)
- [GSC API limits](https://developers.google.com/webmaster-tools/limits)
- [OAuth 2.0 for Web Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
