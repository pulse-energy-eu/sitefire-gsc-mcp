# GSC MCP v1 - Infrastructure and Customer Journey Plan

**Status:** Draft for review.
**Date:** 2026-04-16.
**Context:** Informed by scanning the production sitefire MCP (pulse-geo/routes/api/mcp.ts), the parallel Bing MCP (sitefire-bing-mcp/DESIGN.md), and the current GSC MCP (this repo).

## Ground truth from the three repos

### Production sitefire MCP (pulse-geo)

The production MCP is already hosted and running:

- **Hosting:** Vercel serverless function at `/api/mcp`
- **Transport:** Streamable HTTP (stateless, `sessionIdGenerator: undefined`, `enableJsonResponse: true`)
- **Auth:** Supabase JWT via `Authorization` header. Requires a sitefire account. RLS scopes all data by userId + companyId.
- **Tools:** ~20 tools - sitefire analytics (visibility overview, topic positions, topic opportunities, source performance, actions, briefings, article generation, onboarding status) + 7 Bing Webmaster tools
- **Bing integration pattern:** Bing tools are **conditionally loaded** per request. On each POST, the server checks `bing_credentials` table for the user. If found, all 7 Bing tools appear. If not, only sitefire-core tools are registered.
- **Observability:** PostHog tracking on every tool call, structured logging with trace IDs
- **OAuth discovery:** GET returns 401 with `WWW-Authenticate` pointing to `/api/mcp/oauth-metadata`
- **Constraint:** Vercel's 800-second timeout means no long-lived SSE. Immediate close on GET forces clients to POST-only Streamable HTTP.

### Bing MCP (sitefire-bing-mcp)

- **Current:** Local stdio, `npx github:pulse-energy-eu/sitefire-bing-mcp`, API key auth
- **Phase 1 (planned):** npm publish as `@sitefire/sitefire-bing-mcp` + setup wizard at `sitefire.ai/bing-seo`
- **Phase 2 (deferred):** Remote HTTP at `mcp.sitefire.ai/bing`, "only if distribution demands it"
- **Key insight:** Bing tools are ALREADY live in the production MCP. The standalone repo is the lead-magnet distribution, the production MCP is where they live long-term.

### GSC MCP (this repo)

- **Current:** Local stdio, `npx github:pulse-energy-eu/sitefire-gsc-mcp`, Google OAuth (refresh token at `~/.sitefire-gsc/token.json`)
- **7 tools**, 101 tests, hardened, dist built. v0 code complete.

## The pattern that's already working

The production MCP demonstrates the architecture:

```
sitefire account (Supabase JWT)
  ├── sitefire-core tools (always loaded, ~13 tools)
  └── bing tools (conditionally loaded if bing_credentials row exists, 7 tools)
```

GSC fits the same pattern:

```
sitefire account (Supabase JWT)
  ├── sitefire-core tools (always loaded)
  ├── bing tools (conditionally loaded if bing_credentials exists)
  └── gsc tools (conditionally loaded if gsc_credentials exists)     ← new
```

## The tension: lead magnet vs. account-gated

The Bing tools in the production MCP require a sitefire account. That's fine for existing customers adding Bing data.

But the GSC MCP's purpose is a **free lead magnet** - no sitefire account required. Every SEO person has GSC. Zero friction to first value.

The customer journey needs TWO entry points that converge:

```
Entry A (lead magnet):           Entry B (existing customer):
  Free GSC MCP (local)             sitefire MCP (hosted)
  No account needed                Account required
  7 GSC tools only                 sitefire + Bing + GSC tools
       │                                │
       │  "Want AI visibility            │
       │   insights too?"                │
       │                                 │
       └──────────┬──────────────────────┘
                  │
            sitefire account
            + full hosted MCP
            (GSC + Bing + sitefire)
```

## Recommended architecture

### Phase 1: Two distributions, shared tool code

**1a. Free local MCP (this repo, ships now)**

What it is today. Local stdio, Google OAuth, 7 GSC tools. No changes needed.

- Distribution: `npx github:...` now, `npx @sitefire/sitefire-gsc-mcp` after npm publish
- Setup wizard: `sitefire.ai/gsc-seo` (same pattern as Bing's `sitefire.ai/bing-seo`)
- Nudge mechanism: `setup_check` response includes a `tip` field:
  ```json
  {
    "tip": "Want AI visibility insights for your site across ChatGPT, Gemini, and Perplexity? Try the full sitefire MCP at sitefire.ai/mcp"
  }
  ```
  Non-intrusive. Appears once in setup, not in every tool response.

**1b. GSC tools in production MCP (pulse-geo)**

Same pattern as Bing:

- New `gsc_credentials` table in Supabase: `user_id`, `refresh_token_encrypted`, `last_used_at`, `created_at`
- OAuth setup page at `sitefire.ai/connect/gsc`:
  - User clicks "Connect Google Search Console"
  - Google OAuth flow runs (sitefire.ai as the redirect target, not localhost)
  - Refresh token stored in `gsc_credentials`
  - User returns to Claude, GSC tools now appear
- In `mcp.ts`: check `gsc_credentials` table alongside `bing_credentials`, conditionally register GSC tools
- The 7 GSC tool implementations are extracted to `_shared/gsc-tools.ts` (same pattern as `_shared/bing-tools.ts`)

**Shared tool code:** The tool logic (the functions in `src/tools/*.ts`) is portable. The local MCP wraps them with `getAuthClient()` + stdio. The production MCP wraps them with `gsc_credentials` lookup + HTTP. The business logic is identical.

### Phase 2: Deprecate local, promote hosted (only if data supports it)

If usage data shows that most GSC MCP users eventually create sitefire accounts, the local MCP becomes an onboarding ramp rather than a permanent product. At that point:

- The local MCP's `setup_check` could offer: "You can also connect GSC to your sitefire account for a unified dashboard"
- Eventually, the local MCP could become a thin shim that helps users set up the hosted MCP instead

This is a data-driven decision. Not something to commit to now.

## What this means for the TODOS.md items

| TODO item | Verdict |
|---|---|
| Windsor.ai competitive teardown | **Still useful** but lower priority. Windsor competes in ChatGPT's app directory. We compete in Claude's MCP ecosystem. Different distribution channels. Do when planning Phase 2 ChatGPT entry. |
| Composio GSC MCP audit | **Deprioritized.** The production MCP already runs on Vercel. The "build vs buy infra" question is answered: build, on the infra we already have. Composio adds a dependency without clear upside. |
| Token-refresh validation (pre-v2 gate) | **Answered.** The production MCP already handles OAuth tokens in Supabase with server-side refresh. For the local MCP, google-auth-library handles refresh transparently. No validation needed. |
| Incremental OAuth scope upgrade | **Still v2.** No change. |
| CI smoke check | **Still post-v0.** No change. |

## Concrete next steps (in order)

1. **npm publish** the local GSC MCP as `@sitefire/sitefire-gsc-mcp` (Phase 1 distribution)
2. **Add nudge** to `setup_check` response: one-line tip pointing to full sitefire MCP
3. **Extract GSC tool logic** into a portable module that can be imported by both the local MCP and the production MCP
4. **Add `gsc_credentials` table** to Supabase schema
5. **Build OAuth connect page** at `sitefire.ai/connect/gsc`
6. **Integrate GSC tools** into `pulse-geo/routes/api/mcp.ts` (same conditional pattern as Bing)
7. **Build setup wizard** at `sitefire.ai/gsc-seo` for the local MCP's Phase 1 distribution

## Open decisions

| Decision | Options | Recommendation |
|---|---|---|
| Where does shared tool code live? | (a) Copy into pulse-geo, (b) npm package imported by both, (c) git submodule | **(a) Copy.** Same approach used for Bing. The tool code is stable and small (7 files). A shared package adds dependency management overhead for minimal benefit at this scale. |
| OAuth for hosted path: sitefire's GCP project or same one? | (a) Same "sitefire" GCP OAuth app, (b) Separate app for hosted | **(a) Same app.** One consent screen, one verification submission. The redirect URI differs (localhost vs sitefire.ai) but Google supports multiple redirect URIs per client. |
| Nudge aggressiveness | (a) setup_check only, (b) every tool response, (c) after N tool calls | **(a) setup_check only.** The lead magnet must feel genuinely free. Aggressive nudging destroys trust with the SEO audience. |
