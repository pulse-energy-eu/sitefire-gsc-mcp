#!/usr/bin/env tsx
/**
 * Record live GSC API fixtures from sitefire.ai.
 *
 * Requires:
 *   - ~/.sitefire-gsc/token.json with valid OAuth credentials
 *   - GSC_PROPERTY env var (defaults to sc-domain:sitefire.ai)
 *
 * Usage:
 *   GSC_PROPERTY=sc-domain:sitefire.ai npx tsx scripts/record-fixtures.ts
 *
 * Outputs sanitized JSON files to test/fixtures/live/.
 * See test/fixtures/REDACTION.md for redaction rules.
 */

import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import * as fs from "node:fs";
import * as path from "node:path";

const PROPERTY = process.env.GSC_PROPERTY ?? "sc-domain:sitefire.ai";
const FIXTURES_DIR = path.join(import.meta.dirname ?? __dirname, "../test/fixtures/live");

async function main() {
  // Load token
  const tokenPath = path.join(
    process.env.HOME ?? process.env.USERPROFILE ?? ".",
    ".sitefire-gsc",
    "token.json",
  );
  if (!fs.existsSync(tokenPath)) {
    console.error("No token found at", tokenPath);
    console.error("Run the MCP once to complete OAuth, then re-run this script.");
    process.exit(1);
  }

  const token = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
  const auth = new OAuth2Client(
    process.env.SITEFIRE_GSC_CLIENT_ID,
    process.env.SITEFIRE_GSC_CLIENT_SECRET,
  );
  auth.setCredentials(token);

  const webmasters = google.webmasters({ version: "v3", auth });
  const searchconsole = google.searchconsole({ version: "v1", auth });

  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() - 3); // freshness lag
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 27);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  // 1. sites.list
  console.log("Recording sites.list...");
  const sitesRes = await webmasters.sites.list();
  writeFixture("sites-list.json", sitesRes.data);

  // 2. searchAnalytics - aggregate
  console.log("Recording searchAnalytics aggregate...");
  const aggRes = await webmasters.searchanalytics.query({
    siteUrl: PROPERTY,
    requestBody: {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      rowLimit: 1,
    },
  });
  writeFixture("searchanalytics-aggregate.json", aggRes.data);

  // 3. searchAnalytics - by query (top 10)
  console.log("Recording searchAnalytics by query...");
  const byQueryRes = await webmasters.searchanalytics.query({
    siteUrl: PROPERTY,
    requestBody: {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions: ["query"],
      rowLimit: 10,
    },
  });
  writeFixture("searchanalytics-by-query.json", byQueryRes.data);

  // 4. searchAnalytics - by page (top 10)
  console.log("Recording searchAnalytics by page...");
  const byPageRes = await webmasters.searchanalytics.query({
    siteUrl: PROPERTY,
    requestBody: {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions: ["page"],
      rowLimit: 10,
    },
  });
  writeFixture("searchanalytics-by-page.json", byPageRes.data);

  // 5. searchAnalytics - striking distance (positions 11-20)
  console.log("Recording searchAnalytics striking distance...");
  const strikingRes = await webmasters.searchanalytics.query({
    siteUrl: PROPERTY,
    requestBody: {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions: ["query"],
      rowLimit: 25,
    },
  });
  writeFixture("searchanalytics-striking-distance.json", strikingRes.data);

  // 6. searchAnalytics - cannibalization (query + page)
  console.log("Recording searchAnalytics cannibalization...");
  const cannRes = await webmasters.searchanalytics.query({
    siteUrl: PROPERTY,
    requestBody: {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions: ["query", "page"],
      rowLimit: 100,
    },
  });
  writeFixture("searchanalytics-cannibalization.json", cannRes.data);

  // 7. searchAnalytics - drop comparison (current week)
  console.log("Recording searchAnalytics drop current...");
  const dropCurrentEnd = new Date(endDate);
  const dropCurrentStart = new Date(dropCurrentEnd);
  dropCurrentStart.setDate(dropCurrentStart.getDate() - 6);
  const dropCurrentRes = await webmasters.searchanalytics.query({
    siteUrl: PROPERTY,
    requestBody: {
      startDate: fmt(dropCurrentStart),
      endDate: fmt(dropCurrentEnd),
      dimensions: ["query"],
      rowLimit: 25,
    },
  });
  writeFixture("searchanalytics-drop-current.json", dropCurrentRes.data);

  // 8. searchAnalytics - drop comparison (previous week)
  console.log("Recording searchAnalytics drop previous...");
  const dropPrevEnd = new Date(dropCurrentStart);
  dropPrevEnd.setDate(dropPrevEnd.getDate() - 1);
  const dropPrevStart = new Date(dropPrevEnd);
  dropPrevStart.setDate(dropPrevStart.getDate() - 6);
  const dropPrevRes = await webmasters.searchanalytics.query({
    siteUrl: PROPERTY,
    requestBody: {
      startDate: fmt(dropPrevStart),
      endDate: fmt(dropPrevEnd),
      dimensions: ["query"],
      rowLimit: 25,
    },
  });
  writeFixture("searchanalytics-drop-previous.json", dropPrevRes.data);

  // 9. sitemaps.list
  console.log("Recording sitemaps.list...");
  const sitemapsRes = await webmasters.sitemaps.list({ siteUrl: PROPERTY });
  writeFixture("sitemaps-list.json", sitemapsRes.data);

  // 10. urlInspection - indexed URL
  console.log("Recording urlInspection (indexed)...");
  const rootUrl = PROPERTY.startsWith("sc-domain:")
    ? `https://${PROPERTY.slice("sc-domain:".length)}/`
    : PROPERTY;
  try {
    const inspectRes = await searchconsole.urlInspection.index.inspect({
      requestBody: {
        inspectionUrl: rootUrl,
        siteUrl: PROPERTY,
        languageCode: "en-US",
      },
    });
    writeFixture("urlinspection-indexed.json", inspectRes.data);
  } catch (err) {
    console.warn("urlInspection failed (may be rate-limited):", (err as Error).message);
  }

  console.log("\nDone. Fixtures written to", FIXTURES_DIR);
  console.log("Review redaction rules in test/fixtures/REDACTION.md before committing.");
}

function writeFixture(filename: string, data: unknown): void {
  const filepath = path.join(FIXTURES_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2) + "\n");
  console.log("  ->", filepath);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
