# Changelog

All notable changes to sitefire-gsc-mcp will be documented in this file.

## [Unreleased]

### Hardening
- Startup sites.list call now races against a 3-second timeout per DESIGN.md spec
- OAuth flow generates and validates a `state` parameter to prevent CSRF
- Auth singleton prevents concurrent browser launches when multiple tools fire before auth exists
- 429 rate-limit errors now include reset time from `Retry-After` header when available

### Changed
- Rate-limit error message generalized from "URL-inspection limit" to "rate limit" (429 can occur on any endpoint)

## [0.1.0] - 2026-04-16

### Added

**Day 1 - Foundation**
- OAuth 2.0 Installed App Flow (`src/auth.ts`): local-loopback redirect, token persistence at `~/.sitefire-gsc/token.json`, auto-refresh, browser opener with 30-second timeout
- GSC API client (`src/gsc-client.ts`): typed wrapper around `googleapis` for sites.list, searchAnalytics.query, urlInspection.index.inspect, sitemaps.list with retry-once on 5xx
- Error translation layer (`src/gsc-errors.ts`): maps all seven Google API error patterns (401, 403 permission, 403 scope, 429, 400, 404, 5xx, network, timeout) to user-facing messages with concrete next actions
- Fixture recording script (`scripts/record-fixtures.ts`) for capturing live API responses from sitefire.ai
- 7 live fixtures (sitefire.ai data) and 7 synthetic edge-case fixtures
- 33 unit tests covering all error translation paths, API client methods, retry logic, and auth module
- README install guide with `claude mcp add` command, OAuth walkthrough, 7-tool table, privacy section, troubleshooting, Inspector checklist
- Project scaffolding: package.json, tsconfig.json, vitest.config.ts

**Day 2 - Tools (part 1)**
- `list_my_properties` tool: lists all accessible GSC properties with permission levels
- `setup_check` tool: validates auth, property access, sitemap status, and data availability with guided next actions
- `inspect_url` tool: URL index status, canonical handling, mobile usability, plain-English interpretation
- `find_opportunities` tool: composite three-slice response (striking distance, low-hanging fruit, zero-click queries)
- 32 unit tests for the four tools

**Day 3 - Tools (part 2) + server glue**
- `weekly_report` tool: comprehensive weekly performance with clicks/impressions/CTR/position, top queries/pages, sitemap health, week-over-week deltas, partial failure handling via Promise.allSettled
- `detect_cannibalization` tool: finds queries where multiple pages compete, with consolidation recommendations
- `traffic_drop_diagnosis` tool: compares current vs previous period, attributes root cause (query loss, rank drop, coverage loss, seasonal), shows top losers
- MCP server entry point (`src/index.ts`): tool registry, startup validation banner (soft-fail), `handleToolCall` helper for auth + error boilerplate
- 32 unit tests for the three tools

**Codex review fixes (Day 3)**
- Fixed `setup_check` auth ordering: `checkAuth()` called after `getClient()` so OAuth flow completes before validation
- Added try/catch around OAuth startup validation to prevent unhandled rejections
- Fixed date off-by-one in period calculations
- Fixed typo in `detect_cannibalization` description

**Distribution**
- OAuth credentials moved to env vars (`SITEFIRE_GSC_CLIENT_ID`, `SITEFIRE_GSC_CLIENT_SECRET`) for GitHub push protection compatibility
- `dist/` committed for `npx github:pulse-energy-eu/sitefire-gsc-mcp` distribution
- `bin` entry and `files` config in package.json for npx execution
