# sitefire-gsc-mcp — v0 design doc

**Status:** Design revised to mirror `sitefire-bing-mcp` patterns. Ready to implement.
**Target repo:** `pulse-energy-eu/sitefire-gsc-mcp` (to be created; local path `/Users/jochenmadler/programming/work/sitefire-gsc-mcp/`).
**Last reviewed:** 2026-04-15 by `/plan-eng-review` + Codex outside voice (all tensions resolved) + cross-check against `sitefire-bing-mcp` DESIGN.md.
**Supersedes:** an in-session Python + FastMCP iteration (never committed). Switched to TypeScript + `@modelcontextprotocol/sdk` for portfolio consistency with sitefire-bing-mcp and to make distribution via `npx` one-step for the non-technical audience.

## TL;DR

A local stdio Model Context Protocol (MCP) server that wraps the Google Search Console API and ships as a sister lead-magnet to `sitefire-bing-mcp`. Users install it into Claude Desktop via one `npx` command, click through a single Google OAuth consent, and ask Claude questions about their site's Google organic visibility. Seven composite, outcome-named tools (not thirty API wrappers). No hosting required from sitefire. Time to v0: **3-4 focused days.**

Together with `sitefire-bing-mcp`, sitefire owns both ends of the generative-engine retrieval story: Google (GSC) and the Bing-backed assistants (ChatGPT Search, Copilot, Perplexity).

## Why this exists

Google Search Console is the universal SEO dataset. Every SEO professional has at least one GSC property configured. But the native GSC UI is opaque for non-technical users: 16-month rolling window, sampling that hides the tail, no composite reports, and the Performance page UI that takes 5+ clicks to answer "am I losing traffic?"

Non-technical SEO/GEO marketers would benefit enormously from asking Claude the same question and getting a one-paragraph answer grounded in their own GSC data. Today they can't, because no hosted GSC MCP exists, and the eight local MCPs on GitHub all require Python/Node setup, a manually-created OAuth client in GCP, and a hand-edited Claude Desktop config.

This MCP is the missing one-command install.

## Audience

Persona: same as sitefire-bing-mcp. SEO/GEO marketer at a small-to-mid business. Has GSC set up (almost guaranteed — unlike Bing). Uses Claude Desktop. Does not write code. Will not debug their own JSON config unless guided with screenshots.

**Hard constraints** this implies:

- Every error message is a user-readable sentence with a concrete next action. Never raw Google `403 PERMISSION_DENIED` codes, never Python stack traces.
- Every tool description is written for "what does this do for my site?" not "what API does this call?"
- First tool invocation must succeed. GSC has NO cross-site data tool (unlike Bing's `keyword_opportunity`), so `setup_check` must deliver the day-0 value: confirm the OAuth worked, list properties, flag any setup issues.
- Installation is `npx github:...`, one OAuth consent popup, done. No GCP project creation, no `client_secrets.json` download, no CLI `gcloud auth`, no config paste-in-file.

## Product principles

Inherit all five from sitefire-bing-mcp. Restated for consistency:

1. **Outcome-named tools.** `weekly_report`, not `get_search_analytics`.
2. **Structured responses.** Tools return typed JSON. The model renders the table, prose, or emoji. No pre-rendered markdown inside tool output.
3. **Soft failures, guided recovery.** Bad auth → `"run setup_check"`. Property not accessible → `"run list_my_properties"`. Rate limit → `"try again after {reset time}"`.
4. **Boring by default.** `@modelcontextprotocol/sdk` (official), stdio transport, `googleapis` npm package, `zod` for schemas, `vitest` for tests. Zero innovation tokens spent on infra.
5. **Zero persistence beyond the OAuth token.** No database, no server-side user identity. Each MCP instance is a single-user process on that user's laptop. The only persisted artifact is a Google OAuth refresh token at `~/.sitefire-gsc/token.json` (chmod 600), written by `google-auth-library` on first consent, refreshed automatically thereafter.

## Scope

### In scope (v0)

- Seven composite MCP tools (detailed below)
- Central `gsc-client.ts` handling Google API calls via `googleapis`, typed error mapping, retry-once on 5xx
- Error translation layer (`gsc-errors.ts`) mapping the six known Google API error patterns to user-facing messages
- `auth.ts` handling OAuth 2.0 Installed App Flow: local-loopback redirect, token persistence at `~/.sitefire-gsc/token.json`, auto-refresh
- Startup soft-warn on missing/invalid token (does not hard-fail; `setup_check` routes the user)
- Test fixtures: sitefire.ai live-captured + synthetic edge cases (zero data, insufficient scope, revoked token, quota exhausted, property not owned)
- `@modelcontextprotocol/inspector` walkthrough checklist in README
- Install guide in README for non-technical user: prerequisites, one `claude mcp add` command, first-run OAuth consent walkthrough with screenshots, expected stderr banner
- Distribution via `npx github:pulse-energy-eu/sitefire-gsc-mcp`

### Explicitly NOT in scope (v0)

| Item | Why deferred |
|---|---|
| CI integration tests against live GSC API | Matches Bing MCP — accepted manual-discipline risk; TODO captured for post-v0 |
| Remote MCP / HTTP transport | Phase 2; only if ChatGPT reach demands it (v2-remote research running in parallel) |
| `webmasters` full scope (write operations: sitemap submit, site add) | v2 via incremental OAuth re-consent. v0 stays on `webmasters.readonly`. |
| `siteverification` scope | v2 bundle with the scope upgrade |
| BigQuery bulk-export integration | v2 or later. `tools/gsc/README.md` in geo-content repo already documents the setup for sitefire's own analytics. |
| npm publish pipeline | Phase 1 (friendlies install via `npx github:...`) |
| Usage analytics / telemetry | Phase 1; v0 validation is direct customer interviews |
| Pre-rendered markdown output | Dropped per MCP best-practice; model renders |
| Google OAuth app verification | Submitted in parallel with v0 build (non-sensitive scope, process is lighter but still weeks). "Unverified app" warning persists in the OAuth consent screen during verification; documented in the install guide as a trust-filter for early adopters. |

### What already exists (reuse, do not rebuild)

| Asset | Used for |
|---|---|
| `geo-content/tools/gsc/smoke-test.py` | Python reference for the GSC API calls we make (sites.list, searchAnalytics.query, urlInspection.index.inspect, sitemaps.list). Port the call patterns to TypeScript using `googleapis`. Discard the file itself. |
| `geo-content/tools/gsc/README.md` | Endpoint reference, cadence table, BigQuery setup, gotchas (16-month window, sampling, scope limits, property types). Source of truth for `gsc-client.ts` behavior decisions. |
| `geo-content/sitefire/gsc-service-account.json` + vault routing | NOT directly reused (that SA is for sitefire's own internal GSC access, not end-user OAuth). But the `push-secrets.py` pattern will ship sitefire's OAuth client_id + client_secret (the ones baked into the MCP package) via the same vault. |
| `sitefire-bing-mcp` architecture | Direct template. Same module layout, same test strategy, same startup behavior, same distribution path. This design doc exists specifically to keep the two MCPs in lockstep. |
| `modelcontextprotocol/typescript-sdk` | Foundation — same as Bing. |

## Architecture

### Data flow

```
┌──────────────┐   stdio (JSON-RPC)   ┌────────────────┐   HTTPS   ┌──────────────┐
│ Claude       │ ◄──────────────────► │ sitefire-gsc   │ ────────► │ Google       │
│ Desktop      │                      │ -mcp (local)   │           │ Search       │
└──────────────┘                      └────────────────┘           │ Console API  │
       │                                       │                   └──────────────┘
       │ user asks:                            │
       │ "How is my site doing on Google?"     │ reads token from
       ▼                                       │ ~/.sitefire-gsc/token.json
  [tool call: weekly_report]                   │ (first run: OAuth browser flow,
                                               │  subsequent: auto-refresh)
                                               ▼
                          ┌───────────────────────────────────┐
                          │ Promise.allSettled fan-out:       │
                          │   searchAnalytics.query (aggregate)│
                          │   searchAnalytics.query (byQuery) │
                          │   searchAnalytics.query (byPage)  │
                          │   sitemaps.list                   │
                          ├───────────────────────────────────┤
                          │ compose structured JSON           │
                          │ (handle partial failure, empty)   │
                          └───────────────────────────────────┘
                                               │
                                               ▼
                                 return to Claude Desktop
                                 Claude renders for the user
```

### Module layout

Mirrors Bing MCP file-for-file:

```
sitefire-gsc-mcp/
├── src/
│   ├── index.ts                  # MCP server, tool registry, startup validation
│   ├── auth.ts                   # OAuth Installed App Flow, token persistence, refresh
│   ├── gsc-client.ts             # googleapis wrapper, sampling-aware, typed errors
│   ├── gsc-errors.ts             # translateError: raw Google → user messages
│   └── tools/
│       ├── list-my-properties.ts
│       ├── setup-check.ts
│       ├── weekly-report.ts
│       ├── inspect-url.ts
│       ├── find-opportunities.ts       # composite: striking_distance + low_hanging_fruit + low_click_queries
│       ├── detect-cannibalization.ts
│       └── traffic-drop-diagnosis.ts
├── scripts/
│   └── record-fixtures.ts        # Live capture → sanitized JSON fixtures
├── test/
│   ├── fixtures/
│   │   ├── live/                 # Recorded from real GSC API (sitefire.ai)
│   │   ├── synthetic/            # Hand-crafted edge cases
│   │   └── REDACTION.md
│   ├── auth.test.ts
│   ├── gsc-client.test.ts
│   ├── gsc-errors.test.ts
│   └── tools/*.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

**Ten source files, eight test files, one fixture directory.** One more source file than Bing because GSC adds `auth.ts` (Bing has no auth module — API key lives in env). Still well under the 8-files-without-justification threshold; each file has a single reason to change.

### Error translation table

Every error surfaced to the user goes through `translateError()`. Authoritative mapping:

| Google raw | Trigger | User-facing message |
|---|---|---|
| `401 UNAUTHENTICATED` / invalid_grant | Token expired or revoked (user revoked at myaccount.google.com, or refresh token expired) | "Your Google authorization was revoked or expired. Run `setup_check` to re-authenticate." |
| `403 PERMISSION_DENIED` (no property access) | Service account or user account doesn't own / have access to the requested property | "You don't have access to `{site_url}`. Run `list_my_properties` to see what you do have, or sign in with a different Google account." |
| `403 PERMISSION_DENIED` (insufficient scope) | Call needs `webmasters` full, we only have `webmasters.readonly` | "This action requires more access than you granted. v0 is read-only; upgrade coming soon." (should be unreachable from v0 tools — never exposed) |
| `429 RESOURCE_EXHAUSTED` (URL Inspection limits) | 2000/day per site, 600/min | "Google's URL-inspection limit for this site has been hit. Try again in a minute or tomorrow." (includes reset time when available) |
| `400 INVALID_ARGUMENT` (property format) | Malformed site_url, e.g., missing `sc-domain:` or trailing slash mismatch | "The property `{site_url}` isn't in the right format. Run `list_my_properties` to see the exact strings Google uses." |
| `404 NOT_FOUND` | Property deleted, or user signed in with wrong account | "No such property in this Google account. Run `list_my_properties`." |
| 5xx from Google | Transient | Automatic retry once after 250ms. On second failure: "Google is temporarily unavailable. Try again in a moment." |
| Network timeout | User offline / DNS issue | "Couldn't reach Google. Check your internet connection." |

## The seven tools

Each tool spec defines: the customer question it answers, its signature, the structured return shape, the empty-state behavior, and the test-required branches.

### 1. `list_my_properties`

**Answers:** "Which sites are under my Google account?"

**Signature:** `list_my_properties() → PropertyList`

**Return shape:**
```ts
{
  properties: Array<{
    site_url: string,                    // "sc-domain:sitefire.ai" or "https://sitefire.ai/"
    permission_level: "siteOwner" | "siteFullUser" | "siteRestrictedUser" | "siteUnverifiedUser",
    type: "domain" | "url_prefix"
  }>,
  count: number,
  next_step: string | null              // if zero properties: pointer to setup_check
}
```

**Underlying call:** `webmasters.sites.list()`.

**Empty state:** `{ properties: [], count: 0, next_step: "No properties in this Google account. Run setup_check for a step-by-step guide to adding your first one." }`.

**Required tests:** happy path with 1+ properties (sitefire fixture); empty-properties fixture; revoked-token fixture.

### 2. `setup_check`

**Answers:** "Is everything configured correctly?" / "Where do I get started?"

**Signature:** `setup_check(site_url?: string) → SetupReport`

**Return shape:**
```ts
{
  auth_valid: boolean,
  properties_count: number,
  properties: string[],                  // URLs of accessible properties
  target_site: string | null,            // if site_url provided or only-1-property
  checks: {
    property_accessible: "pass" | "fail" | "n/a",
    sitemap_submitted: "pass" | "fail" | "n/a",
    data_available: "pass" | "pending" | "n/a",   // pending if new property (< 3 days since first crawl)
    has_clicks_in_28d: "pass" | "fail" | "n/a"
  },
  next_actions: string[]                 // ordered, concrete, e.g. "Add https://sitefire.ai/sitemap.xml under the Sitemaps section in search.google.com/search-console"
}
```

**Underlying calls:** `sites.list`, optionally `sitemaps.list(site_url)`, optionally `searchAnalytics.query(last 28d, aggregate)`.

**Empty state for new property:** `next_actions = ["Your property is added but Google hasn't collected data yet. Typical wait: 2-7 days.", "Submit a sitemap at search.google.com/search-console.", ...]`

**Empty state for no properties at all:** `next_actions = ["Add a property at search.google.com/search-console.", "Verify domain ownership via DNS TXT or HTML file upload.", "Come back and run setup_check again."]`

**Required tests:** all four check combinations (pass/fail × auth valid/invalid); target_site inference when site_url omitted and user has exactly 1 property; `next_actions` includes property-creation pointer when zero properties; pending data_available when new property.

### 3. `weekly_report`

**Answers:** "How is my site doing on Google this week?"

**Signature:** `weekly_report(site_url: string) → WeeklyReport`

**Return shape:**
```ts
{
  period: { start: ISO8601, end: ISO8601 },
  site_url: string,
  is_new_property: boolean,
  rollup: {
    clicks: number,
    impressions: number,
    ctr: number,                         // decimal, e.g. 0.58
    avg_position: number,                // weighted by impressions
    queries_count: number,
    pages_count: number
  } | null,
  wow_delta: {
    clicks: number,                      // percentage change, decimal
    impressions: number,
    ctr: number,
    avg_position: number                 // position delta (negative = improvement)
  } | null,
  top_queries: QueryRow[],               // top 10
  top_pages: PageRow[],                  // top 10
  sitemap_count: number,
  sitemap_health: {
    errors: number,
    warnings: number,
    last_downloaded: ISO8601 | null
  },
  partial_failures: string[],            // endpoints that failed in allSettled
  empty_state_guidance: string | null    // non-null when is_new_property
}
```

**Underlying calls (parallel via `Promise.allSettled`):** `searchAnalytics.query` with 3 variants (aggregate, by-query, by-page) + `sitemaps.list`.

**Empty state:** `is_new_property = true` when property exists but no data returned for the last 28 days. `empty_state_guidance = "This property is too fresh to show search data. Google typically populates GSC within 2-7 days of first crawl. Run setup_check for a status summary, or come back in a few days."`

**Required tests:** happy path with sitefire fixtures; 1-of-4 endpoint fails → partial_failures populated, rest of report intact; all empty → is_new_property true + guidance set; invalid site → routes to translateError.

### 4. `inspect_url`

**Answers:** "What does Google know about this specific URL?"

**Signature:** `inspect_url(site_url: string, url: string) → UrlInspection`

**Return shape:**
```ts
{
  url: string,
  site_url: string,
  verdict: "PASS" | "PARTIAL" | "FAIL" | "NEUTRAL",
  coverage_state: string,                // e.g. "Submitted and indexed"
  last_crawl_time: ISO8601 | null,
  crawl_age_days: number | null,
  robots_allowed: boolean,
  indexing_allowed: boolean,
  google_canonical: string | null,
  user_canonical: string | null,
  canonical_mismatch: boolean,
  referring_urls: string[],              // up to 5
  crawled_as: "MOBILE" | "DESKTOP",
  mobile_usable: boolean | null,
  interpretation: {
    state: "indexed" | "crawled_not_indexed" | "canonical_mismatch" | "blocked" | "unknown",
    summary: string,
    recommended_action: string | null
  }
}
```

Deliberately richer than Bing's `inspect_url` because GSC's URL Inspection endpoint returns richer data (canonical handling, mobile usability, rich results). The `interpretation` field stays simple.

**Underlying call:** `urlInspection.index.inspect()`.

**Required tests:** indexed (verdict PASS) → state=indexed; crawled but not indexed → state=crawled_not_indexed + action; canonical mismatch → state=canonical_mismatch + explanation; robots-blocked → state=blocked + fix-pointer; URL not under property → translateError; rate-limit hit → translateError with reset time.

### 5. `find_opportunities` (composite)

**Answers:** "What should I focus on to grow my Google traffic?"

**Signature:** `find_opportunities(site_url: string, days?: number) → Opportunities`

Composite that returns THREE opportunity slices in one structured response. Replaces the three separate tools (`find_striking_distance`, `find_low_hanging_fruit`, `low_click_queries`) I'd proposed earlier. Single tool, three branches of insight — matches Bing's `weekly_report` composite discipline.

**Return shape:**
```ts
{
  period: { start: ISO8601, end: ISO8601 },
  site_url: string,
  striking_distance: {
    description: "Queries ranking at positions 11-20. One click-through-rate jump away from page 1.",
    queries: Array<QueryRow & { recommendation: string }>   // top 15
  },
  low_hanging_fruit: {
    description: "High-impression queries with below-average CTR. Meta title/description rewrites likely win.",
    queries: Array<QueryRow & { recommendation: string }>   // top 15
  },
  low_click_queries: {
    description: "Queries with impressions but zero clicks. Either content mismatch or SERP feature ate the click.",
    note: "GSC hides queries that received fewer than ~10 daily searches due to user-privacy thresholds. These aren't in this list.",
    queries: QueryRow[]                                      // top 15
  }
}
```

**Underlying calls:** `searchAnalytics.query` with 3 different filter strategies (parallel).

**Required tests:** each of the three filter strategies produces the expected row set; zero-data property → empty arrays with guidance; invalid site → translateError.

### 6. `detect_cannibalization`

**Answers:** "Are multiple pages on my site competing for the same Google query?"

**Signature:** `detect_cannibalization(site_url: string, min_impressions?: number) → CannibalizationReport`

**Return shape:**
```ts
{
  period: { start: ISO8601, end: ISO8601 },
  site_url: string,
  threshold: number,                     // min_impressions default 50
  cannibalized_queries: Array<{
    query: string,
    competing_pages: Array<{
      page: string,
      clicks: number,
      impressions: number,
      position: number
    }>,
    total_impressions: number,
    recommended_action: string            // "Consolidate into the page at {url}, redirect others"
  }>,
  note: string                           // "GSC anonymizes queries with low search volumes; cannibalization on long-tail terms may be invisible."
}
```

Honest framing: this is a heuristic on the visible (sampled, non-anonymized) query data. The `note` field states the limit.

**Underlying call:** `searchAnalytics.query` with dimensions `["query", "page"]`.

**Required tests:** multi-page cannibalization detected; single-page no-cannibalization case; low-impression filtering; invalid site → translateError.

### 7. `traffic_drop_diagnosis`

**Answers:** "Why did my Google traffic drop? Is it one query, many queries, a specific page, or everything?"

**Signature:** `traffic_drop_diagnosis(site_url: string, compare_period?: "wow" | "mom") → DropDiagnosis`

**Return shape:**
```ts
{
  site_url: string,
  compare: { current_period: Period, previous_period: Period },
  overall_change: {
    clicks: number,                      // percentage, decimal
    impressions: number,
    position: number
  },
  root_cause_attribution: {
    primary: "query_loss" | "rank_drop" | "coverage_loss" | "seasonal" | "none",
    confidence: "high" | "medium" | "low",
    explanation: string
  },
  top_query_losses: Array<QueryRow & { delta: { clicks: number, impressions: number, position: number } }>,
  top_page_losses: Array<PageRow & { delta: { clicks: number, impressions: number, position: number } }>,
  note: string                           // warns about GSC's 2-3 day freshness lag and sampling
}
```

**Underlying calls:** `searchAnalytics.query` × 2 (current period + previous period) with dimensions `["query"]` and `["page"]`, parallel.

**Required tests:** significant drop with clear root cause (query_loss); rank_drop scenario; flat-traffic-no-drop case; new property (not enough history to compare) → `root_cause_attribution.primary = "none"` + guidance; invalid site → translateError.

## Startup behavior

Same pattern as Bing MCP. When the MCP process starts:

1. Check for `~/.sitefire-gsc/token.json`. If absent or invalid: emit stderr banner `"sitefire-gsc-mcp v0.X — no Google authorization yet. All tools will route you through setup_check to complete the OAuth flow."` Continue.
2. If present, call `sites.list` with a 3-second timeout. Three outcomes:
   - Success: emit stderr banner `"sitefire-gsc-mcp v0.X — connected. N accessible properties found."`
   - `401 UNAUTHENTICATED` / invalid_grant: delete the bad token, emit banner `"Your Google authorization expired or was revoked. Run setup_check to re-authenticate."`
   - Network timeout / other: emit warning banner `"Could not reach Google to validate authorization. Tools will retry on first invocation."`
3. Register all seven tools. Server ready.

**Critical design choice (inherited from Bing MCP):** do not hard-fail at startup. The tool that tells the user how to fix their setup is `setup_check`; hard-failing prevents them from reaching it.

On first tool invocation, if no token exists, `auth.ts` triggers the OAuth Installed App Flow: opens the user's default browser with Google's consent URL, runs a local-loopback HTTP server on a random port to catch the redirect, exchanges the auth code for tokens, persists `token.json`, and returns control to the tool.

## Test strategy

Three layers. Mirrors Bing MCP.

### Layer 1 — Unit tests with fixtures (run always, <2s)

- `vitest` for runner
- `googleapis` calls mocked via test-level interception of the underlying `google-auth-library` HTTP client
- Fixtures live in `test/fixtures/live/` (captured from sitefire.ai via `scripts/record-fixtures.ts`, sanitized) and `test/fixtures/synthetic/` (hand-crafted edge cases)
- One test file per module (`auth`, `gsc-client`, `gsc-errors`, each tool)
- Target coverage: 100% of branches in the code-path diagram below

### Layer 2 — Integration tests against live GSC API

- Local only, guarded by `INTEGRATION=1` env var
- ~6 tests touching the real endpoints we depend on (sites.list, searchAnalytics × 3 variants, sitemaps.list, urlInspection.index.inspect)
- Run manually before each release to a friendly customer
- **Accepted risk:** Google-side silent regressions may escape this. TODO captured for post-v0 cron smoke check.

### Layer 3 — Manual MCP inspector walkthrough

Pre-release checklist in README:
- [ ] Start MCP with `@modelcontextprotocol/inspector`
- [ ] First run: browser opens for OAuth consent; `~/.sitefire-gsc/token.json` created after consent
- [ ] `list_my_properties` returns sitefire.ai
- [ ] `setup_check` with valid token → all green
- [ ] `setup_check` against non-owned property → appropriate guidance
- [ ] `weekly_report` on a site with known data → non-empty report
- [ ] `weekly_report` on a fresh property → empty_state_guidance set
- [ ] `inspect_url` on an indexed page → verdict=PASS; on a 404 URL → appropriate state
- [ ] `find_opportunities` → three-slice response
- [ ] `detect_cannibalization` → either cannibalization found or honest empty case
- [ ] `traffic_drop_diagnosis` → attribution populated
- [ ] Deliberately delete `token.json`, restart → stderr banner, `list_my_properties` triggers re-auth flow

### Fixtures — sources

| Source | Contents |
|---|---|
| `live/` | `sites-list.json`, `searchanalytics-aggregate.json`, `searchanalytics-by-query.json`, `searchanalytics-by-page.json`, `searchanalytics-striking-distance.json`, `searchanalytics-cannibalization.json`, `searchanalytics-drop-current.json`, `searchanalytics-drop-previous.json`, `sitemaps-list.json`, `urlinspection-indexed.json`, `urlinspection-canonical-mismatch.json`. Captured via `scripts/record-fixtures.ts` against sitefire.ai. Sanitized per REDACTION.md. |
| `synthetic/` | `empty-properties.json`, `new-property-no-data.json`, `revoked-token.json`, `insufficient-scope.json`, `rate-limited-429.json`, `invalid-property-404.json`, `url-not-under-site.json`. Hand-crafted. |

Redaction rules: strip any referring URL that could leak non-sitefire data, strip query strings that could reveal sensitive intent (e.g., queries containing customer names), strip the full OAuth token if accidentally captured.

### Forward-looking coverage diagram

```
CODE PATH COVERAGE (v0 target)
════════════════════════════════════
[+] src/auth.ts
    ├── [REQUIRED] first run: no token → open browser → callback → persist
    ├── [REQUIRED] subsequent run: token valid → return OAuth2 client
    ├── [REQUIRED] subsequent run: token expired → refresh → return client
    ├── [REQUIRED] subsequent run: refresh token invalid → delete token, trigger re-auth
    └── [REQUIRED] token file permission error → catch OSError, surface clear message

[+] src/gsc-client.ts
    gscFetch(method, params)
    ├── [REQUIRED] Happy path: returns typed payload
    ├── [REQUIRED] 401 invalid_grant → delete token, throw ReauthRequired
    ├── [REQUIRED] 403 no access → throw GscApiError("PERMISSION_DENIED")
    ├── [REQUIRED] 429 rate limit → throw with reset time
    ├── [REQUIRED] 400 bad argument → throw with parameter hint
    ├── [REQUIRED] 5xx transient → retry once after 250ms → success on retry
    ├── [REQUIRED] 5xx transient → retry once → still 5xx → throws "HTTP_FAIL"
    └── [REQUIRED] Network timeout → throws TimeoutError

[+] src/gsc-errors.ts
    translateError(raw)
    ├── [REQUIRED] 401 / invalid_grant → ReauthRequired user msg
    ├── [REQUIRED] 403 PERMISSION_DENIED (no property) → user msg pointing to list_my_properties
    ├── [REQUIRED] 403 PERMISSION_DENIED (scope) → "upgrade coming soon" (unreachable from v0)
    ├── [REQUIRED] 429 RESOURCE_EXHAUSTED → rate-limit user msg + reset time
    ├── [REQUIRED] 400 INVALID_ARGUMENT → format-hint user msg
    ├── [REQUIRED] 404 NOT_FOUND → list_my_properties pointer
    └── [REQUIRED] Unknown error → generic msg + raw code (acceptable)

[+] src/tools/list-my-properties.ts
    ├── [REQUIRED] 1+ properties → structured list
    └── [REQUIRED] 0 properties → setup_check pointer

[+] src/tools/setup-check.ts
    ├── [REQUIRED] All green (sitefire fixture)
    ├── [REQUIRED] Auth valid, 0 properties → property-creation pointer
    ├── [REQUIRED] Property accessible, no sitemap → submit-sitemap action
    ├── [REQUIRED] Property accessible, data pending → "wait 2-7 days" guidance
    └── [REQUIRED] target_site inference when site_url omitted + single-property account

[+] src/tools/weekly-report.ts
    ├── [REQUIRED] Happy path: 4 allSettled calls compose
    ├── [REQUIRED] 1-of-4 rejects → partial_failures populated, rest intact
    ├── [REQUIRED] All empty → is_new_property=true, empty_state_guidance set
    └── [REQUIRED] Invalid site → routes to translateError

[+] src/tools/inspect-url.ts
    ├── [REQUIRED] Indexed (verdict PASS) → state=indexed
    ├── [REQUIRED] Crawled not indexed → state=crawled_not_indexed + action
    ├── [REQUIRED] Canonical mismatch → state=canonical_mismatch + explanation
    ├── [REQUIRED] Robots-blocked → state=blocked + fix-pointer
    ├── [REQUIRED] URL not under site → translateError
    └── [REQUIRED] 429 rate limit → translateError with reset time

[+] src/tools/find-opportunities.ts
    ├── [REQUIRED] Striking distance filter → positions 11-20 only
    ├── [REQUIRED] Low hanging fruit filter → high impressions + CTR below site avg
    ├── [REQUIRED] Low click queries filter → impressions > N, clicks = 0
    └── [REQUIRED] Zero-data property → empty arrays + guidance

[+] src/tools/detect-cannibalization.ts
    ├── [REQUIRED] Multi-page cannibalization detected
    ├── [REQUIRED] No cannibalization → empty report
    ├── [REQUIRED] Low-impression filtering respects threshold
    └── [REQUIRED] Anonymization caveat in every response

[+] src/tools/traffic-drop-diagnosis.ts
    ├── [REQUIRED] Clear query_loss root cause
    ├── [REQUIRED] Clear rank_drop root cause
    ├── [REQUIRED] Flat traffic → primary=none
    └── [REQUIRED] New property → insufficient history guidance

USER FLOW COVERAGE (manual, pre-release)
════════════════════════════════════════
[+] Install flow
    ├── Fresh machine → README → claude mcp add → first tool call → OAuth consent → success < 5 min
    └── Invalid token → stderr banner visible in Claude Desktop log

[+] First-call flow
    ├── First question "run setup_check" → green checklist (or guided to fix)
    └── First question on fresh property → empty_state_guidance
```

## Failure mode analysis

Each new codepath, one realistic production failure, whether v0 covers it:

| Codepath | Failure scenario | Unit test | Error handling | User sees |
|---|---|---|---|---|
| `auth.ts` | Browser doesn't open (headless/CI environment) | ✓ | ✓ | Fallback: copy-paste flow with manual URL; google-auth-library supports this natively |
| `auth.ts` | Token file permission error (read-only home) | ✓ | ✓ | Clear error with fallback path suggestion |
| `auth.ts` | User grants consent but closes browser before redirect | ✓ | ✓ 30s timeout | "OAuth flow did not complete. Re-run setup_check to retry." |
| `gscFetch` | 5xx transient | ✓ | ✓ retry-once | Auto-recovered OR "temporarily unavailable" |
| `translateError` | Unknown error code | ✓ | ✓ | Generic msg + raw code (acceptable) |
| `weekly_report` | 1 of 4 rejects | ✓ | ✓ | Partial report + `partial_failures` |
| `weekly_report` | Completely empty data (new property) | ✓ | ✓ | `empty_state_guidance` set |
| `inspect_url` | Rate limit 429 | ✓ | ✓ | Reset-time guidance |
| `inspect_url` | Canonical mismatch | ✓ | ✓ | `interpretation.state = canonical_mismatch` + explanation |
| `detect_cannibalization` | GSC anonymized the long-tail | ✓ | ✓ note | Honest caveat in every response |
| startup | No token yet | ✓ | ✓ | Soft-warn + setup_check routing |
| startup | Token revoked between sessions | ✓ | ✓ | Soft-warn + auto-delete bad token + re-auth routing |
| `list_my_properties` | Zero properties | ✓ | ✓ | setup_check pointer |

**No critical gaps.** The 5xx-retry-once and auto-delete-bad-token-on-401 close what would have been silent-failure paths.

## Onboarding — verified and unverified

### What's known about the Google OAuth consent UX (April 2026)

- User has a Google account (ubiquitous).
- User must grant `webmasters.readonly` scope (non-sensitive per Google's classification).
- **"Unverified app" warning** displays during consent until Google approves our verification submission. The warning requires the user to click "Advanced → Go to sitefire (unsafe)" to continue. Off-putting for some, trust-filter for early adopters. Verification for non-sensitive scopes takes 2-6 weeks per Google's own docs; submitted in parallel with build.
- After consent, refresh token is long-lived (doesn't expire for Production-status OAuth apps, per Google's policy).
- User can revoke at `myaccount.google.com/permissions` anytime. Our `auth.ts` handles the resulting `invalid_grant` on next use.

### What needs first-person dry-run (before v0 ships to friendly #1)

- End-to-end stopwatch timing. Microsoft says "a few minutes"; Google doesn't commit to a number. Time it from a cold-start Google account that's never used GSC.
- Screenshot every screen of the OAuth consent flow, including the "unverified app" warning (needed for README).
- Verify that the local-loopback redirect actually works on macOS, Windows, Linux. Especially test on machines where a random port is blocked or where multiple browser profiles exist.
- Test what happens when the user signs in with the wrong Google account (one without any GSC properties). Does `list_my_properties` return empty + route to setup_check? Expected yes.

**De-risk before v0 ships:** a clean-browser dry-run, stopwatch, screenshots. ~30 minutes. Produces the setup guide, de-risks the onboarding premise.

## Parallelization lanes

| Lane | Modules | Depends on |
|---|---|---|
| A | `src/auth.ts`, `src/gsc-client.ts`, `src/gsc-errors.ts`, their tests | — |
| B | `scripts/record-fixtures.ts`, `test/fixtures/live/*`, `test/fixtures/synthetic/*`, `REDACTION.md` | — |
| C | 7 tool implementations in `src/tools/*.ts` with tests | A, B |
| D | `README.md`, install guide with OAuth screenshots, Inspector checklist | — (OAuth dry-run produces the screenshots) |
| E | `src/index.ts` (MCP server setup, tool registry, startup behavior) | A, C |

**Execution:** A + B + D in parallel → C (the 7 tools can themselves be parallelized) → E. Worktree orchestration saves ~30% wall time.

## Time estimate

**3-4 focused days for v0.**

- Day 1: Lanes A + B + D in parallel. Scaffold, auth, gsc-client, gsc-errors, fixture script + initial capture + synthetics, README skeleton. OAuth dry-run for screenshots.
- Day 2: Lane C part 1. Four smaller tools (`list_my_properties`, `setup_check`, `inspect_url`, `find_opportunities`). Each with tests.
- Day 3: Lane C part 2. Three larger tools (`weekly_report`, `detect_cannibalization`, `traffic_drop_diagnosis`). Lane E server glue.
- Day 4: Inspector walkthrough, polish, README completion, one friendly-customer dry-run.

## Distribution and hosting

Mirrors Bing MCP exactly.

| Phase | Channel | sitefire-side cost |
|---|---|---|
| v0 (internal + friendlies) | `npx github:pulse-energy-eu/sitefire-gsc-mcp` | $0. GitHub public repos are free. |
| Phase 1 (lead magnet) | `npx @sitefire/sitefire-gsc-mcp` (npm) + setup wizard page at `sitefire.ai/gsc-seo` | $0 incremental. npm registry free. Wizard is a route on existing sitefire.ai hosting. |
| Phase 2 (remote MCP — deferred pending research) | Hosted HTTP MCP at `mcp.sitefire.ai/gsc` | $5-20/month on Fly.io. Only if distribution + ChatGPT research gates green-light. |

The MCP runs on the user's laptop. sitefire is never in the request path. Zero infrastructure cost for v0 and Phase 1.

## Watch list: upcoming Google features

### BigQuery bulk-export API improvements (rumored, not verified)

Google has indicated at past Search Central Live events that programmatic BigQuery export management is on the roadmap. Today the bulk export is configured via the GSC UI only. If/when an API lands, we add a tool `enable_bulk_export(site_url, gcp_project_id)` that configures it programmatically — removing the 5-step manual UI flow.

**Status as of April 2026:** UI-only. No known public endpoints. Speculative. Candidate for v1+ once available.

### URL Inspection API scope expansion (unconfirmed)

Current URL Inspection returns rich data but is capped at 2,000/day per site. Google has acknowledged the cap is limiting for large sites and hinted at quota negotiation. If lifted, our `inspect_url` tool's usage ceiling rises.

**Status:** speculative. No v0 impact.

### GSC AI Performance report parity with Bing (unconfirmed)

Bing shipped an AI Performance report in Feb 2026 showing Copilot citations per site. Google has not publicly announced an equivalent, but the market pressure is strong. If Google ships one, we mirror Bing MCP's planned `citation_trend` and `who_cited_this_page` tools.

**Status:** no evidence yet. Watch.

## Phase 1 hints (post-validation)

After v0 validates with 2-3 friendly customers:

- Publish to npm as `@sitefire/sitefire-gsc-mcp` with proper versioning
- Setup wizard: `sitefire.ai/gsc-seo`, 3 screens:
  - "Do you have Google Search Console?" (Yes / No paths)
  - If No: 2-minute GSC property-creation walkthrough with screenshots
  - If Yes: "Click here to install" → copy Claude Desktop config → "Click here to authorize" (our OAuth URL)
- Short launch post on sitefire blog positioning the tool in the GEO narrative, paired with Bing MCP launch for "two halves of generative search"
- Instrument `setup_check` with optional anonymous success/fail ping (explicit opt-in; respects lead-magnet trust story)

## Open questions / known risks

| Risk | Severity | Mitigation |
|---|---|---|
| "Unverified app" warning scares away non-technical users | High, medium likelihood | Verification submitted in parallel; README documents the warning honestly; early adopters self-select as tolerant |
| Non-technical user fails at `npx` install | Medium, medium likelihood | Phase 1 setup wizard addresses. v0 friendlies assumed able to follow README. |
| Claude Desktop MCP format changes | Low, low likelihood | Structured-response approach is MCP-spec-idiomatic |
| Google OAuth consent changes (e.g., new required fields on consent screen) | Low, low likelihood | Monitor Google Identity changelog; quick fix |
| `googleapis` npm package breaking change | Low, medium likelihood (it's actively developed) | Pin major version; dependabot alerts |
| User revokes OAuth mid-session | Medium, low likelihood | `auth.ts` detects invalid_grant, auto-deletes token, routes to re-auth |
| GSC UI-only features that matter (e.g., manual actions, disavow) | Low, medium likelihood | Document in README "why this tool doesn't show X"; point to UI |
| Installation trust (random GitHub project asks to access GSC) | Medium, medium likelihood | Public repo, MIT license, README explicit about what data leaves their machine (only GSC data, straight HTTPS to Google; nothing sent to sitefire) |

## References

- `sitefire-bing-mcp/DESIGN.md` — sister MCP design doc; this doc mirrors its structure deliberately
- `geo-content/tools/gsc/README.md` — endpoint reference, BigQuery setup, gotchas, scope limits
- `geo-content/tools/gsc/smoke-test.py` — Python reference for the API calls we port to TypeScript
- `geo-content/sitefire/gsc-service-account.json` — sitefire's own GSC access (unrelated to this MCP's end-user OAuth flow)
- [Google Search Console API v3 reference](https://developers.google.com/webmaster-tools/v1/api_reference_index) — Google primary docs
- [Search Console API limits](https://developers.google.com/webmaster-tools/limits) — URL Inspection 2000/day, 600/min
- [OAuth 2.0 for Installed Applications](https://developers.google.com/identity/protocols/oauth2/native-app) — the auth flow we use
- [Model Context Protocol SDK for TypeScript](https://github.com/modelcontextprotocol/typescript-sdk) — our foundation
- [`googleapis` npm package](https://github.com/googleapis/google-api-nodejs-client) — Google API client for Node.js
