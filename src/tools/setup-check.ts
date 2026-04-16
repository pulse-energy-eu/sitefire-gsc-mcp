/**
 * setup_check tool.
 *
 * Answers: "Is everything configured correctly?" / "Where do I get started?"
 * Runs a checklist: auth valid, properties accessible, sitemap submitted,
 * data available, has clicks.
 */

import type { GscClient } from "../gsc-client.js";
import { type GscApiError } from "../gsc-errors.js";
import { type AuthState } from "../auth.js";
import { gscDateRange } from "./shared/gsc-dates.js";

export interface SetupReport {
  auth_valid: boolean;
  properties_count: number;
  properties: string[];
  target_site: string | null;
  checks: {
    property_accessible: "pass" | "fail" | "n/a";
    sitemap_submitted: "pass" | "fail" | "n/a";
    data_available: "pass" | "pending" | "n/a";
    has_clicks_in_28d: "pass" | "fail" | "n/a";
  };
  next_actions: string[];
}

function defaultChecks(): SetupReport["checks"] {
  return {
    property_accessible: "n/a",
    sitemap_submitted: "n/a",
    data_available: "n/a",
    has_clicks_in_28d: "n/a",
  };
}

export async function setupCheck(
  client: GscClient,
  authState: AuthState,
  siteUrl?: string,
): Promise<SetupReport> {
  const next_actions: string[] = [];
  const checks = defaultChecks();

  // Auth check
  const authValid = authState.status === "valid";
  if (!authValid) {
    return {
      auth_valid: false,
      properties_count: 0,
      properties: [],
      target_site: null,
      checks,
      next_actions: [
        "Run any tool to start the Google OAuth flow, or re-run setup_check after authorizing.",
      ],
    };
  }

  // List properties
  let propertyUrls: string[];
  try {
    const sites = await client.listSites();
    propertyUrls = sites.map((s) => s.siteUrl);
  } catch (err) {
    throw err as GscApiError;
  }

  if (propertyUrls.length === 0) {
    return {
      auth_valid: true,
      properties_count: 0,
      properties: [],
      target_site: null,
      checks,
      next_actions: [
        "Add a property at search.google.com/search-console.",
        "Verify domain ownership via DNS TXT or HTML file upload.",
        "Come back and run setup_check again.",
      ],
    };
  }

  // Determine target site
  let targetSite: string | null = null;
  if (siteUrl) {
    targetSite = siteUrl;
  } else if (propertyUrls.length === 1) {
    targetSite = propertyUrls[0];
  }

  // If no target site, can't run property-level checks
  if (!targetSite) {
    return {
      auth_valid: true,
      properties_count: propertyUrls.length,
      properties: propertyUrls,
      target_site: null,
      checks,
      next_actions: [
        `You have ${propertyUrls.length} properties. Specify a site_url to run property-level checks.`,
      ],
    };
  }

  // Property accessible check
  if (propertyUrls.includes(targetSite)) {
    checks.property_accessible = "pass";
  } else {
    checks.property_accessible = "fail";
    next_actions.push(
      `The property ${targetSite} is not accessible under this Google account. Run list_my_properties to see what you do have.`,
    );
    return {
      auth_valid: true,
      properties_count: propertyUrls.length,
      properties: propertyUrls,
      target_site: targetSite,
      checks,
      next_actions,
    };
  }

  // Sitemap check
  try {
    const sitemaps = await client.listSitemaps(targetSite);
    checks.sitemap_submitted = sitemaps.length > 0 ? "pass" : "fail";
    if (sitemaps.length === 0) {
      next_actions.push(
        "Submit a sitemap at search.google.com/search-console under the Sitemaps section.",
      );
    }
  } catch {
    checks.sitemap_submitted = "n/a";
  }

  // Data availability + clicks check
  const period = gscDateRange(28);

  try {
    const analytics = await client.querySearchAnalytics(targetSite, {
      startDate: period.start,
      endDate: period.end,
    });

    if (analytics.rows.length === 0) {
      checks.data_available = "pending";
      checks.has_clicks_in_28d = "n/a";
      next_actions.push(
        "Your property is added but Google hasn't collected data yet. Typical wait: 2-7 days.",
      );
    } else {
      checks.data_available = "pass";
      const totalClicks = analytics.rows.reduce((sum, r) => sum + r.clicks, 0);
      checks.has_clicks_in_28d = totalClicks > 0 ? "pass" : "fail";
      if (totalClicks === 0) {
        next_actions.push(
          "Google has data for your property but no clicks in the last 28 days. This is normal for new or low-traffic sites.",
        );
      }
    }
  } catch {
    checks.data_available = "n/a";
    checks.has_clicks_in_28d = "n/a";
  }

  if (next_actions.length === 0) {
    next_actions.push("Everything looks good. Try running weekly_report to see your search performance.");
  }

  return {
    auth_valid: true,
    properties_count: propertyUrls.length,
    properties: propertyUrls,
    target_site: targetSite,
    checks,
    next_actions,
  };
}
