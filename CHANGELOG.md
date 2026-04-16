# Changelog

All notable changes to sitefire-gsc-mcp will be documented in this file.

## [0.1.0.0] - 2026-04-16

### Added
- OAuth 2.0 Installed App Flow (`src/auth.ts`): local-loopback redirect, token persistence at `~/.sitefire-gsc/token.json`, auto-refresh, browser opener with 30-second timeout
- GSC API client (`src/gsc-client.ts`): typed wrapper around `googleapis` for sites.list, searchAnalytics.query, urlInspection.index.inspect, sitemaps.list with retry-once on 5xx
- Error translation layer (`src/gsc-errors.ts`): maps all seven Google API error patterns (401, 403 permission, 403 scope, 429, 400, 404, 5xx, network, timeout) to user-facing messages with concrete next actions
- Fixture recording script (`scripts/record-fixtures.ts`) for capturing live API responses from sitefire.ai
- 7 live fixtures (sitefire.ai placeholder data) and 7 synthetic edge-case fixtures
- 33 unit tests covering all error translation paths, API client methods, retry logic, and auth module
- README install guide with `claude mcp add` command, OAuth walkthrough, 7-tool table, privacy section, troubleshooting, Inspector checklist
- Project scaffolding: package.json, tsconfig.json, vitest.config.ts
