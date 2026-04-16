# sitefire-gsc-mcp

> Local Model Context Protocol server for Google Search Console insights, inside Claude Desktop. One OAuth click, zero hosting. Designed for non-technical SEO/GEO professionals.

**Status:** v0 in development.

## What this is

A Claude Desktop MCP that wraps the Google Search Console API behind seven composite, outcome-named tools. Install with one command, click through a single Google OAuth consent, ask Claude questions about your site's Google organic visibility.

**Why Google Search Console:** the universal SEO dataset. Every SEO professional has at least one property configured. The native GSC UI is capable but opaque: 16-month rolling window, sampling that hides the long tail, reports that take 5+ clicks to answer "am I losing traffic and why?" This MCP puts those answers one chat message away.

**Companion tool:** [sitefire-bing-mcp](https://github.com/pulse-energy-eu/sitefire-bing-mcp) covers the generative-engine side (ChatGPT Search, Copilot, Perplexity all retrieve from the Bing index). Together they cover both halves of modern search.

## What you need

- [Claude Desktop](https://claude.ai/download)
- A Google account with at least one verified property in [Google Search Console](https://search.google.com/search-console)
- Node.js 18+ installed
- About 5 minutes for the one-time install + OAuth flow

## Quick install

### Step 1: Add the MCP to Claude Desktop

Run this in your terminal:

```bash
claude mcp add sitefire-gsc \
  -e SITEFIRE_GSC_CLIENT_ID="727930320778-6slogb932botu9q4dfngll7aghl567l4.apps.googleusercontent.com" \
  -e SITEFIRE_GSC_CLIENT_SECRET="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" \
  -- npx -y github:pulse-energy-eu/sitefire-gsc-mcp
```

Or manually add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "sitefire-gsc": {
      "command": "npx",
      "args": ["-y", "github:pulse-energy-eu/sitefire-gsc-mcp"],
      "env": {
        "SITEFIRE_GSC_CLIENT_ID": "727930320778-6slogb932botu9q4dfngll7aghl567l4.apps.googleusercontent.com",
        "SITEFIRE_GSC_CLIENT_SECRET": "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"
      }
    }
  }
}
```

### Step 2: Restart Claude Desktop

Close and reopen Claude Desktop. You'll see "sitefire-gsc" in the MCP tools list.

### Step 3: Authorize with Google

Ask Claude: **"Run setup_check"**

Your browser will open to Google's OAuth consent screen. You'll see:

<!-- TODO: Add screenshot of consent screen -->

1. Sign in with the Google account that owns your Search Console properties
2. You may see an "unverified app" warning (this is normal during our verification process). Click **Advanced** then **Go to sitefire (unsafe)**
3. Grant read-only access to Search Console data
4. The browser shows "Authorization successful!" - return to Claude

That's it. Your authorization is saved locally at `~/.sitefire-gsc/token.json` and auto-refreshes.

## The seven tools

| Tool | What it answers |
|---|---|
| `setup_check` | "Is everything configured correctly?" |
| `list_my_properties` | "Which sites are under my Google account?" |
| `weekly_report` | "How is my site doing on Google this week?" |
| `inspect_url` | "What does Google know about this specific URL?" |
| `find_opportunities` | "What should I focus on to grow my Google traffic?" |
| `detect_cannibalization` | "Are multiple pages competing for the same query?" |
| `traffic_drop_diagnosis` | "Why did my Google traffic drop?" |

## Example questions

After setup, just ask Claude naturally:

- "How is sitefire.ai doing on Google this week?"
- "Check if https://sitefire.ai/blog/geo-guide is indexed"
- "What opportunities do I have to grow my Google traffic?"
- "Are any of my pages competing for the same keywords?"
- "My traffic dropped last week - what happened?"

## Privacy and security

- **All data stays on your machine.** This MCP runs locally as a subprocess of Claude Desktop. No data is sent to sitefire or any third party.
- **Read-only access.** The MCP only requests `webmasters.readonly` scope. It cannot modify your Search Console properties, submit sitemaps, or make any changes.
- **Your OAuth token** is stored at `~/.sitefire-gsc/token.json` (file permissions 600, readable only by you). You can revoke access anytime at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
- **Open source.** MIT license. Read every line of code in this repository.

## Troubleshooting

### "Your Google authorization was revoked or expired"

Run `setup_check` again. This re-triggers the OAuth flow.

### "No properties found"

You're signed into a Google account that doesn't have any Search Console properties. Either:
- Add a property at [search.google.com/search-console](https://search.google.com/search-console)
- Delete `~/.sitefire-gsc/token.json` and run `setup_check` to sign in with a different account

### "Unverified app" warning during OAuth

This is expected while our Google OAuth app verification is in progress. The warning appears because Google hasn't yet reviewed our app. Click **Advanced** then **Go to sitefire (unsafe)** to proceed. We only request read-only access to your Search Console data.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode
npm run test:watch

# Run with MCP Inspector
npm run inspect

# Record live fixtures (requires valid OAuth token)
GSC_PROPERTY=sc-domain:sitefire.ai npm run record-fixtures
```

## MCP Inspector walkthrough (pre-release checklist)

- [ ] Start MCP with `@modelcontextprotocol/inspector`
- [ ] First run: browser opens for OAuth consent; `~/.sitefire-gsc/token.json` created after consent
- [ ] `list_my_properties` returns sitefire.ai
- [ ] `setup_check` with valid token - all green
- [ ] `setup_check` against non-owned property - appropriate guidance
- [ ] `weekly_report` on a site with known data - non-empty report
- [ ] `weekly_report` on a fresh property - empty_state_guidance set
- [ ] `inspect_url` on an indexed page - verdict=PASS; on a 404 URL - appropriate state
- [ ] `find_opportunities` - three-slice response
- [ ] `detect_cannibalization` - either cannibalization found or honest empty case
- [ ] `traffic_drop_diagnosis` - attribution populated
- [ ] Deliberately delete `token.json`, restart - stderr banner, `list_my_properties` triggers re-auth flow

## License

MIT. See [LICENSE](LICENSE).

Built by [sitefire](https://sitefire.ai) (YC W26). Released as a free lead-magnet tool for the GEO community.
