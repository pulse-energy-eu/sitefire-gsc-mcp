# TODOS — sitefire-gsc-mcp

Work deferred out of v0 with enough context to pick it up later.

---

## Post-v0: Windsor.ai competitive teardown (1 hour)

**What:** Install Windsor.ai's GSC app in the ChatGPT directory ([chatgpt.com/apps/windsor-ai/asdk_app_694a52cfaa3c819192bea84eaa254968](https://windsor.ai/how-to-connect-google-search-console-to-chatgpt/)). Map their tool surface, OAuth flow, data framing, and conversational UX. Identify where sitefire's SEO/GEO-opinionated angle beats their generic analytics-hub framing.

**Why:** They already shipped in ChatGPT. v1 (Claude Code) doesn't overlap, but v2 (remote MCP for ChatGPT) would compete directly. Differentiation strategy needs concrete teardown data before v2 commit.

**Pros:** Sharp competitive intel; identifies specific tool/flow gaps.

**Cons:** Requires Windsor.ai account (30-day free trial; sign up, teardown, cancel). Minor.

**Context:** Named in the v2 research agent output (2026-04-15). One of three sub-investigations before committing to v2.

**Depends on:** v1 shipped (optional — can do anytime).

---

## Post-v0: Composio GSC MCP audit (1 hour)

**What:** Sign up for Composio, enumerate the actual tool surface of their hosted GSC MCP (6 tools per their docs: sitemaps, URL inspect, search analytics, list sites, submit sitemap, etc.), test the OAuth experience end-to-end. Evaluate whether a v2 sitefire product could be "MCP tool definitions hosted on Composio" vs "own Fly app + OAuth proxy".

**Why:** If Composio exposes 90%+ of what sitefire v2 would need, the "Composio-underneath" path saves 2-3 months of infra engineering. Trade-off is Composio roadmap dependency.

**Pros:** Potentially massive reduction in v2 engineering scope.

**Cons:** Lose direct customer OAuth relationship; dependent on Composio's GSC roadmap.

**Context:** One of three sub-investigations flagged in the v2 research agent output (2026-04-15) before any v2 commit.

**Depends on:** v1 shipped (informative; not blocking).

---

## Pre-v2 remote: Validate MCP client token-refresh behavior (4 hours)

**What:** Before starting v2 remote MCP work, run a manual end-to-end test: deploy a minimal remote MCP to Fly staging, authorize from Claude Desktop (or ChatGPT Developer Mode), leave idle 75+ minutes so the Google access token expires, then call a tool. Must succeed without a re-auth prompt.

**Why:** v2's "stateless remote MCP with Bearer passthrough" design assumes MCP clients refresh OAuth tokens transparently per spec. If Claude Desktop or ChatGPT's MCP client does NOT do this reliably, a stateless remote MCP is broken — users reauth every hour. This blocks the remote path until verified.

**Pros:** Catches a potential show-stopper before investing weeks in a broken design.

**Cons:** Needs a staging remote MCP. Smallest possible (single echo tool) is enough. ~4h with CC including Fly deploy.

**Context:** This assumption came up during v1 plan review (2026-04-15). We bypassed it for v1 by going local stdio. For v2 it comes back as a P0 gate.

**Depends on:** None. Can run anytime before v2 work starts.

---

## v2: Incremental OAuth scope upgrade for guided setup automation

**What:** When a user asks a future `setup_property` tool to actually ADD a site or complete verification, trigger an incremental OAuth re-consent that expands from `webmasters.readonly` to `webmasters` + `siteverification` scopes.

**Why:** v0 scope is read-only, so `setup_check` can only hand the user DNS/HTML-verification instructions and hope they complete them out-of-band. A real wizard that automates property creation + verification completes the "one-click setup" UX. Requires write scopes.

**Pros:** Differentiator becomes real. Programmatic Add Property + Verify Site. Completes the "lowest-friction GSC onboarding" claim.

**Cons:** Triggers a second OAuth consent screen for users who invoke the feature. Writable scopes may be classified more sensitively by Google (stays sensitive, not restricted — no security assessment needed, verified in v2 research 2026-04-15).

**Context:** Google supports incremental auth natively. Users only re-consent when they invoke a tool that needs the expanded scope. Pattern: Gmail + Drive apps. See developers.google.com/identity/protocols/oauth2/web-server#incrementalAuth.

**Depends on:** v1 shipped with real install data + at least one user explicitly asking for auto-setup.

---

## Post-v0 hardening: CI smoke check against live GSC API

**What:** A scheduled job (GitHub Actions cron, daily) that calls each of our 6 read endpoints against a known test property (sitefire.ai) and flags any behavior change (e.g., field renamed, endpoint deprecated, rate limit changed). Complements the INTEGRATION=1 local tests.

**Why:** v0 accepts "manual discipline" for catching Google-side regressions. That's fine for 1 active customer, fails for 100. Automated cron catches regressions before customers hit them.

**Pros:** Alerts on Google-side silent changes before they become customer bugs.

**Cons:** Uses up a small slice of the 2000/day URL-inspection quota; needs a dedicated OAuth refresh token stored in GitHub secrets (encrypted).

**Context:** Bing MCP captured the same TODO. Parity move.

**Depends on:** npm publish (so version release cadence aligns with CI activation).
