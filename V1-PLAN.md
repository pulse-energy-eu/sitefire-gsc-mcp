# GSC MCP v1 - Infrastructure and Customer Journey Plan

**Status:** Draft v2, rewritten to align with Bing MCP's multi-entry auth design.
**Date:** 2026-04-16.
**Reviewed by:** Codex (adversarial review, 12 findings). Key gaps addressed below.
**Context:** Informed by production sitefire MCP (pulse-geo/routes/api/mcp.ts), Bing MCP integration design (sitefire-bing-mcp), and the current GSC MCP (this repo).

## The model: one URL, one connector, tools expand

Every user pastes the same URL into Claude Desktop:

```
https://app.sitefire.ai/api/mcp
```

Browser opens `app.sitefire.ai/connect`. The auth page shows three options:

```
┌─────────────────────────────────────────────────┐
│                                                 │
│   Connect to Sitefire                           │
│                                                 │
│   Select what you'd like to connect:            │
│                                                 │
│   [x] Google Search Console (free)              │
│       You'll sign in with Google next.          │
│                                                 │
│   [ ] Bing Webmaster Tools (free)               │
│       Paste your Bing API key.                  │
│                                                 │
│   [ ] Sitefire AI Visibility (account required) │
│       Full monitoring across ChatGPT, Gemini,   │
│       Perplexity, and more.                     │
│                                                 │
│           [ Connect ]                           │
│                                                 │
└─────────────────────────────────────────────────┘
```

Each path mints a token with entitlements. Tools expand based on what the user connected:

| User connected | Token entitlements | Tools visible |
|---|---|---|
| GSC only | `["gsc"]` | 7 GSC tools |
| Bing only | `["bing"]` | 7 Bing tools |
| GSC + Bing | `["gsc", "bing"]` | 14 tools |
| Sitefire (full) | `["sitefire"]` | ~15 sitefire tools |
| Sitefire + GSC + Bing | `["sitefire", "gsc", "bing"]` | Everything |

Returning users see what they already have and can add more without losing existing connections.

## Why this replaces the two-distribution model

The previous plan (V1-PLAN.md v1) proposed a free local stdio MCP as the lead magnet, with a separate hosted path for sitefire customers. Codex review found 12 problems with that model. The three biggest:

1. **Duplicate OAuth.** Users who convert from free local to paid hosted must do Google OAuth twice - once locally, once on sitefire.ai. Real friction, weak conversion.
2. **Auth portability is false.** The local MCP's tool code is coupled to local file-based token deletion (`gsc-client.ts:247` imports `deleteToken` from `auth.ts`). Not reusable in hosted without refactoring.
3. **Two connectors.** Free users burn their one custom connector slot on the local MCP. If they convert, they need to remove it and add the hosted one.

The multi-entry auth model solves all three. One URL, one connector, one OAuth per provider. Tools expand, never re-install.

## How the asymmetric auth flows combine

The connect page handles inline credentials first, then OAuth redirects last (since OAuth navigates away).

| Selected | What happens on "Connect" |
|---|---|
| GSC only | Redirect to Google OAuth. Callback stores tokens, redirect to Claude. |
| Bing only | Validate key inline, store it, redirect to Claude. No OAuth. |
| GSC + Bing | Validate Bing key inline first. If valid, store it, then redirect to Google OAuth. Callback stores GSC tokens, redirect to Claude with both entitlements. |
| Sitefire | Redirect to Supabase OAuth. Callback stores session, redirect to Claude. |
| All three | Validate Bing key inline, redirect to Google OAuth, callback chains to Supabase OAuth, redirect to Claude. |

The rule: inline credentials first, then at most one OAuth redirect chain.

State tracking across redirects uses a server-side session or signed state parameter:
```
state = { bing_credential_id: "...", pending_oauth: ["gsc", "sitefire"], callback: "claude://..." }
```

Each OAuth callback pops from `pending_oauth`. When the list is empty, redirect to Claude's callback with the final token.

## Ground truth from the three repos

### Production sitefire MCP (pulse-geo)

Already hosted and running:

- **Hosting:** Vercel serverless function at `/api/mcp`
- **Transport:** Streamable HTTP (stateless, `sessionIdGenerator: undefined`, `enableJsonResponse: true`)
- **Auth:** Supabase JWT via `Authorization` header. RLS scopes all data by userId + companyId.
- **Tools:** ~20 tools. Sitefire analytics + 7 Bing tools (conditionally loaded per request from `bing_credentials` table).
- **Observability:** PostHog tracking on every tool call, structured logging with trace IDs.
- **Constraint:** Vercel's 800-second timeout. No long-lived SSE.

### Bing MCP (sitefire-bing-mcp)

Being merged into pulse-geo. The standalone repo (`npx github:...`) becomes a secondary offline distribution. Primary distribution is the hosted MCP with the multi-entry auth page.

### GSC MCP (this repo)

- **Current:** Local stdio, Google OAuth, 7 tools, 101 tests, hardened, dist built. v0 code complete.
- **Future role:** Secondary distribution for offline/power users. Primary lead magnet path moves to the hosted MCP.

## What changes in the hosted MCP (pulse-geo)

### Auth and entitlements

The current auth model (Supabase JWT, requires sitefire account) needs to expand to support anonymous free users:

- **New concept: MCP connector tokens.** A JWT that carries an `entitlements` array (`["gsc"]`, `["bing"]`, `["sitefire"]`). Minted by the connect page after successful auth for each provider. Not a Supabase session token for free users - a separate, lightweight token scoped to MCP access only.
- **Anonymous users (GSC/Bing only):** Get a connector token with `["gsc"]` and/or `["bing"]`. No sitefire account, no RLS-scoped Supabase client. GSC tools use a server-side `googleapis` client initialized from the stored refresh token. Bing tools use the stored API key directly.
- **Sitefire users:** Get a connector token with `["sitefire"]` plus whatever else they connected. The token also carries `userId` and `companyId` for RLS.

### Tool loading in mcp.ts

Currently (simplified):
```ts
// Always load sitefire tools
registerSitefireTools(server, supabase, companyId);

// Conditionally load Bing
if (bingApiKey) registerBingTools(server, bingApiKey);
```

Becomes:
```ts
const entitlements = decodeToken(bearerToken).entitlements;

if (entitlements.includes("sitefire")) {
  registerSitefireTools(server, supabase, companyId);
}
if (entitlements.includes("bing")) {
  const bingKey = await lookupBingKey(userId);
  if (bingKey) registerBingTools(server, bingKey);
}
if (entitlements.includes("gsc")) {
  const gscAuth = await lookupGscAuth(userId);
  if (gscAuth) registerGscTools(server, gscAuth);
}
```

### New database tables

**`mcp_users`** - anonymous users who connect via GSC/Bing without a sitefire account:
- `id` (uuid, PK)
- `email` (optional, for re-connect)
- `entitlements` (text[], e.g. `["gsc", "bing"]`)
- `created_at`, `last_seen_at`

**`gsc_credentials`** - Google OAuth refresh tokens:
- `id` (uuid, PK)
- `mcp_user_id` (FK to mcp_users) OR `user_id` (FK to sitefire users, nullable)
- `refresh_token_encrypted` (text, AES-256-GCM, see security section)
- `google_email` (text, for display on reconnect)
- `properties_cache` (jsonb, cached site list for fast tool loading)
- `created_at`, `last_used_at`, `revoked_at`

**`bing_credentials`** - already exists, add `mcp_user_id` FK.

### New routes

- **`/api/mcp/connect`** - the multi-select auth page (React or static HTML)
- **`/api/mcp/connect/gsc/callback`** - Google OAuth callback, stores tokens, mints connector token
- **`/api/mcp/connect/bing/validate`** - inline Bing key validation API
- **`/api/mcp/oauth-metadata`** - updated to point to `/api/mcp/connect` instead of Supabase OAuth directly

### GSC tool integration

The 7 GSC tool functions from this repo get copied into `pulse-geo/routes/api/_shared/gsc-tools.ts` (same pattern as `_shared/bing-tools.ts`).

The tool functions need an adapter layer to decouple from local auth:
- Current: tools call `GscClient` which takes an `OAuth2Client` from `getAuthClient()` (local file-based)
- Hosted: tools call `GscClient` which takes an `OAuth2Client` initialized from the stored refresh token in Supabase

The `GscClient` class itself is already clean - it takes an `OAuth2Client` in its constructor. The adapter is just how that client gets created:

```ts
// Local MCP (this repo)
const auth = await getAuthClient(); // reads ~/.sitefire-gsc/token.json
const client = new GscClient(auth);

// Hosted MCP (pulse-geo)
const auth = createOAuth2ClientFromStoredToken(gscCredential.refresh_token_decrypted);
const client = new GscClient(auth);
```

The tool functions (`weeklyReport`, `findOpportunities`, etc.) don't change. Only the auth initialization differs.

### What about `setup_check`?

`setup_check` in the local MCP checks local auth state and tells users to "run any tool to start the OAuth flow." In the hosted MCP, auth already happened on the connect page. So:

- Hosted `setup_check` skips the auth check (the token proves auth is valid)
- Hosted `setup_check` still checks: property accessible, sitemap submitted, data available, has clicks
- The `AuthState` parameter becomes optional - hosted callers pass `{ status: "valid" }` directly

Small change. Not a full rewrite.

## Security: refresh token storage (addressing Codex findings)

Codex flagged this as underspecified. Here's the design:

### Encryption

- **Algorithm:** AES-256-GCM (authenticated encryption)
- **Key management:** Encryption key stored as a Vercel environment variable (`GSC_TOKEN_ENCRYPTION_KEY`). Not in Supabase, not in code.
- **Per-token IV:** Each encrypted token gets a unique random IV, stored alongside the ciphertext.
- **Format:** `iv:ciphertext:authTag` stored in the `refresh_token_encrypted` column.

### Access boundaries

- **RLS:** `gsc_credentials` table has RLS policies. Anonymous MCP users can only read their own row (scoped by `mcp_user_id` from the connector token). Sitefire users scoped by `user_id`.
- **Service role:** Only the MCP server-side code (Vercel function) uses the service role to decrypt tokens. The encryption key never reaches the client.
- **No logging:** Decrypted tokens are never logged, never included in PostHog events, never in error traces. The PostHog `mcp_tool_call` event logs tool name and duration only.

### Lifecycle

- **Rotation:** When Google rotates refresh tokens (issues a new one on access-token refresh), the MCP server detects the new token via the `tokens` event on the OAuth2Client and updates `gsc_credentials`.
- **Revocation:** If a Google API call returns `invalid_grant`, the MCP server marks the credential as `revoked_at = now()` and returns a user-facing error: "Your Google authorization was revoked. Reconnect at app.sitefire.ai/connect."
- **Disconnect:** Users can disconnect GSC from the connect page. This deletes the `gsc_credentials` row and revokes the token with Google's revocation endpoint.
- **Backup exposure:** Supabase backups contain encrypted tokens. Without the Vercel encryption key, they're ciphertext. Key is not stored in Supabase.

### Open: incident response

If the encryption key is compromised, all stored refresh tokens must be considered compromised. Mitigation: rotate the key, re-encrypt all tokens, notify affected users. This needs a runbook before launch.

## Observability: GSC-specific concerns (addressing Codex findings)

### What gets logged

- Tool name and duration (PostHog): yes
- `site_url` parameter: yes (needed for debugging, not sensitive - it's the user's own domain)
- GSC query data (keywords, URLs, impressions): **no**. Tool results are returned to the user only, never logged.
- OAuth token lifecycle events (grant, refresh, revoke): logged as events with `mcp_user_id` only, no token values
- Google email: stored in `gsc_credentials` for reconnect UX, not logged to PostHog

### Redaction rule

The PostHog `mcp_tool_call` event includes: `tool`, `company_id` (if sitefire user), `duration_ms`, `is_error`. It does NOT include: tool arguments, tool results, token values, or GSC data.

## Quota and rate limiting (addressing Codex findings)

### GSC API limits

- `searchAnalytics.query`: no documented per-user limit, but Google throttles heavy usage
- `urlInspection.index.inspect`: 2,000/day per property, 600/min
- `sites.list` and `sitemaps.list`: lightweight, no practical limit

### Hosted concerns

Multiple sitefire users could have the same GSC property (e.g., agency team members). Their tool calls fan out to Google under different OAuth tokens, so per-user limits are separate. But `urlInspection` is per-property, shared across all users with access.

### Mitigation

- **Per-property inspection cache:** Cache `inspect_url` results in `gsc_credentials.properties_cache` (or a separate table) with a 1-hour TTL. Multiple users inspecting the same URL hit the cache, not Google.
- **Retry-After propagation:** Already implemented in `gsc-errors.ts` - 429 errors extract the `Retry-After` header and surface it to the user.
- **No request coalescing in v1.** Serverless (stateless per request) makes coalescing hard. Acceptable for v1 scale. Revisit if agency usage creates bursty patterns.

## Customer journey: the three scenarios

### Scenario A: SEO person discovers free GSC tools (lead magnet)

1. Reads a blog post or recommendation: "Free Google Search Console tools for Claude"
2. Opens Claude Desktop, Settings > Connectors > clicks "+"
3. Pastes: `https://app.sitefire.ai/api/mcp`
4. Browser opens `app.sitefire.ai/connect` - checks "Google Search Console"
5. Google OAuth flow - signs in, grants read-only GSC access
6. Redirect back to Claude. Token minted with `["gsc"]`.
7. 7 GSC tools appear. User asks: "How is my site doing on Google?"

Over time, some tool responses include a soft nudge: "This covers Google search. Sitefire also tracks how ChatGPT, Gemini, and Perplexity cite your site."

### Scenario B: Free user converts to full sitefire

8. User decides they want AI visibility tracking
9. Reconnects (or visits `app.sitefire.ai/connect`)
10. Page shows: "You're connected with: GSC. Want to also add Sitefire?"
11. Signs up for sitefire, goes through onboarding
12. Same connector, same URL. Token entitlements upgrade to `["gsc", "sitefire"]`
13. Next tool call: all sitefire tools + GSC tools appear. No re-install.

### Scenario C: Existing sitefire customer adds GSC

1. Already has the sitefire connector working
2. Reconnects or visits settings page
3. Checks "Google Search Console", does Google OAuth
4. Same connector, enriched with GSC tools

### What the user sees in their Connectors list at each stage

| Stage | Connectors | Tools |
|---|---|---|
| Just installed (GSC only) | sitefire (1 connector) | 7 GSC tools |
| Added Bing too | sitefire (same) | 7 GSC + 7 Bing tools |
| Converted to full sitefire | sitefire (same) | ~15 sitefire + 7 GSC + 7 Bing tools |

One URL, one connector, tools expand based on what the user has set up.

## Nudge strategy

- **In tool responses:** Soft, infrequent. After the first `weekly_report`, include a one-time field: `"tip": "This covers Google search. Sitefire also tracks ChatGPT, Gemini, and Perplexity citations. Connect at app.sitefire.ai/connect"`. Not in every response.
- **On the connect page:** When a GSC-only user reconnects, the page shows what they have and what they could add. This is the primary conversion surface.
- **No nudge in `setup_check`.** That tool is for diagnosing problems, not selling.

## The local stdio MCP (this repo): secondary distribution

The local MCP continues to exist for:

- **Offline use:** No internet dependency on sitefire.ai for GSC queries
- **Privacy-sensitive users:** Data never touches sitefire's servers
- **Non-Claude-Desktop clients:** Any MCP client that supports stdio
- **Power users / developers:** Who prefer running their own process

It is NOT the primary lead magnet path. Blog posts and marketing point to the hosted URL. The local MCP README mentions the hosted option as the easier alternative.

No changes needed to the local MCP's code for this plan. It stays as-is.

## What this means for the TODOS.md items

| TODO item | Verdict |
|---|---|
| Windsor.ai competitive teardown | **Still useful** for ChatGPT directory entry (Phase 2). Lower priority. |
| Composio GSC MCP audit | **Deprioritized.** We're building on our own Vercel infra. |
| Token-refresh validation | **Partially answered.** Local MCP is fine. Hosted path needs validation: does `google-auth-library` on Vercel correctly handle refresh token rotation when initialized from a stored token? Needs a test before launch. |
| Incremental OAuth scope upgrade | **Still v2.** No change. |
| CI smoke check | **Still post-v0.** No change. |

## Concrete next steps (in order)

1. **Build the connect page** at `app.sitefire.ai/connect` (multi-select, handles GSC OAuth + Bing key paste + sitefire OAuth)
2. **Design the connector token format** (JWT with entitlements array, signing key, expiry)
3. **Add `mcp_users` and `gsc_credentials` tables** to Supabase
4. **Implement token encryption** (AES-256-GCM, key in Vercel env)
5. **Update `mcp.ts`** to decode connector tokens and conditionally load tools based on entitlements
6. **Copy GSC tool functions** into `pulse-geo/routes/api/_shared/gsc-tools.ts` with the auth adapter
7. **Validate hosted token refresh** - deploy to staging, connect GSC, wait >1 hour, call a tool. Must succeed without re-auth.
8. **Observability** - add PostHog events for connect/disconnect/tool-call, verify no sensitive data in logs
9. **npm publish** local GSC MCP as `@sitefire/sitefire-gsc-mcp` (secondary distribution)

## Open decisions

| Decision | Options | Recommendation |
|---|---|---|
| Connector token format | (a) Supabase JWT with custom claims, (b) Self-signed JWT | **(b) Self-signed JWT.** Free users don't have Supabase accounts. A self-signed JWT with `entitlements`, `mcp_user_id`, `exp` is simpler and doesn't require Supabase auth for anonymous users. |
| Google OAuth client: same or separate? | (a) Same GCP OAuth app for local + hosted, (b) Separate apps | **(b) Separate apps.** Codex flagged this. Installed-app loopback and hosted HTTPS redirect are different client types in Google's model. Separate clients, separate redirect URIs, separate blast radius. The hosted app uses a "Web application" client type with `app.sitefire.ai/api/mcp/connect/gsc/callback` as the redirect URI. |
| Tool visibility for disconnected providers | (a) Tools absent entirely, (b) Tools visible but disabled with message | **(b) Visible but disabled.** Show all possible tools with a message like "Connect Google Search Console to use this tool" when a user calls a GSC tool without the entitlement. Prevents "where did GSC go?" confusion. |
| Where does shared tool code live? | (a) Copy into pulse-geo, (b) Shared npm package | **(a) Copy.** Same approach used for Bing. The divergence risk (flagged by Codex) is real but manageable at 7 files. A shared package adds CI/versioning overhead. Revisit if we add a third data source. |
| Nudge aggressiveness | (a) One-time tip after first report, (b) Every tool response, (c) Connect page only | **(a) + (c).** One-time tip in the first `weekly_report` response + the connect page shows available upgrades on reconnect. Never in every response. |

## Open work items (from Codex review)

- [ ] Incident response runbook for encryption key compromise
- [ ] Hosted token refresh validation on Vercel staging
- [ ] Agency scenario: one sitefire account, multiple Google accounts connected
- [ ] Disconnect flow: UI + Google token revocation + credential deletion
- [ ] Tool discovery refresh: verify Claude Desktop re-fetches `tools/list` after reconnect (or document that user must restart)
