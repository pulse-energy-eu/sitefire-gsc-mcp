# sitefire-gsc-mcp

> Local Model Context Protocol server for Google Search Console insights, inside Claude Desktop. One OAuth click, zero hosting. Designed for non-technical SEO/GEO professionals.

**Status:** v0 not yet built. Design doc complete and reviewed (/plan-eng-review + Codex outside voice + cross-check against sitefire-bing-mcp). Target: 3-4 focused days to friendly-customer validation.

## What this is

A Claude Desktop MCP that wraps the Google Search Console API behind seven composite, outcome-named tools. Install with one `npx` command, click through a single Google OAuth consent, ask Claude questions about your site's Google organic visibility.

**Why Google Search Console:** the universal SEO dataset. Every SEO professional has at least one property configured. The native GSC UI is capable but opaque: 16-month rolling window, sampling that hides the long tail, reports that take 5+ clicks to answer "am I losing traffic and why?" This MCP puts those answers one chat message away.

**Companion tool:** [sitefire-bing-mcp](https://github.com/pulse-energy-eu/sitefire-bing-mcp) covers the generative-engine side (ChatGPT Search, Copilot, Perplexity all retrieve from the Bing index). Together they cover both halves of modern search.

## What you need

- Claude Desktop
- A Google account with at least one verified property in Google Search Console ([search.google.com/search-console](https://search.google.com/search-console))
- About 5 minutes for the one-time install + OAuth flow

## Next step

See **[DESIGN.md](DESIGN.md)** for the v0 architecture, tool specs, test strategy, failure-mode analysis, and timeline. That document is the spec. Implementation follows.

## Licence

MIT. See [LICENSE](LICENSE).

Built by [sitefire](https://sitefire.ai) (YC W26). Released as a free lead-magnet tool for the GEO community.
