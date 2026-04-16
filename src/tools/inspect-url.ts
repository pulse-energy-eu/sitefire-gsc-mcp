/**
 * inspect_url tool.
 *
 * Answers: "What does Google know about this specific URL?"
 * Calls urlInspection.index.inspect() and returns a structured
 * inspection result with an interpretation layer.
 */

import type { GscClient, UrlInspectionResult } from "../gsc-client.js";

export type InspectionState =
  | "indexed"
  | "crawled_not_indexed"
  | "canonical_mismatch"
  | "blocked"
  | "unknown";

export interface Interpretation {
  state: InspectionState;
  summary: string;
  recommended_action: string | null;
}

export interface UrlInspection {
  url: string;
  site_url: string;
  verdict: "PASS" | "PARTIAL" | "FAIL" | "NEUTRAL";
  coverage_state: string;
  last_crawl_time: string | null;
  crawl_age_days: number | null;
  robots_allowed: boolean;
  indexing_allowed: boolean;
  google_canonical: string | null;
  user_canonical: string | null;
  canonical_mismatch: boolean;
  referring_urls: string[];
  crawled_as: "MOBILE" | "DESKTOP";
  mobile_usable: boolean | null;
  interpretation: Interpretation;
}

function computeCrawlAgeDays(lastCrawlTime: string | null): number | null {
  if (!lastCrawlTime) return null;
  const crawlDate = new Date(lastCrawlTime);
  const now = new Date();
  const diffMs = now.getTime() - crawlDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function deriveInterpretation(idx: UrlInspectionResult["inspectionResult"]["indexStatusResult"]): Interpretation {
  const robotsBlocked =
    idx.robotsTxtState === "DISALLOWED" ||
    idx.robotsTxtState === "BLOCKED_BY_ROBOTS_TXT";
  const indexingBlocked = idx.indexingState === "INDEXING_NOT_ALLOWED";

  // Blocked by robots.txt or noindex
  if (robotsBlocked || indexingBlocked) {
    const blocker = robotsBlocked ? "robots.txt" : "a noindex directive";
    return {
      state: "blocked",
      summary: `This URL is blocked from indexing by ${blocker}.`,
      recommended_action: robotsBlocked
        ? "Update your robots.txt to allow Googlebot access to this URL, then request re-indexing in Search Console."
        : "Remove the noindex tag or X-Robots-Tag header, then request re-indexing in Search Console.",
    };
  }

  // Canonical mismatch
  if (
    idx.googleCanonical &&
    idx.userCanonical &&
    idx.googleCanonical !== idx.userCanonical
  ) {
    return {
      state: "canonical_mismatch",
      summary: `Google chose a different canonical (${idx.googleCanonical}) than the one you specified (${idx.userCanonical}). This URL may not appear in search results.`,
      recommended_action:
        "If this URL should be the canonical, ensure it has unique content, proper internal linking, and a self-referencing canonical tag. Consolidate duplicate content.",
    };
  }

  // Indexed
  if (idx.verdict === "PASS") {
    return {
      state: "indexed",
      summary: "This URL is indexed and eligible to appear in Google Search results.",
      recommended_action: null,
    };
  }

  // Crawled but not indexed
  if (
    idx.coverageState?.includes("Crawled") &&
    idx.coverageState?.includes("not indexed")
  ) {
    return {
      state: "crawled_not_indexed",
      summary:
        "Google crawled this URL but decided not to index it. This often means the content is thin, duplicative, or low-value relative to other pages.",
      recommended_action:
        "Improve the content quality, add unique value, ensure proper internal linking, and request re-indexing in Search Console.",
    };
  }

  // Fallback
  return {
    state: "unknown",
    summary: `Coverage state: ${idx.coverageState}. Verdict: ${idx.verdict}.`,
    recommended_action:
      "Check the URL in Search Console's URL Inspection tool for more details.",
  };
}

export async function inspectUrlTool(
  client: GscClient,
  siteUrl: string,
  url: string,
): Promise<UrlInspection> {
  const result = await client.inspectUrl(siteUrl, url);
  const idx = result.inspectionResult.indexStatusResult;
  const mobile = result.inspectionResult.mobileUsabilityResult;

  const robotsAllowed =
    idx.robotsTxtState !== "DISALLOWED" &&
    idx.robotsTxtState !== "BLOCKED_BY_ROBOTS_TXT";
  const indexingAllowed = idx.indexingState !== "INDEXING_NOT_ALLOWED";

  const googleCanonical = idx.googleCanonical ?? null;
  const userCanonical = idx.userCanonical ?? null;
  const canonicalMismatch =
    googleCanonical !== null &&
    userCanonical !== null &&
    googleCanonical !== userCanonical;

  return {
    url,
    site_url: siteUrl,
    verdict: idx.verdict as UrlInspection["verdict"],
    coverage_state: idx.coverageState,
    last_crawl_time: idx.lastCrawlTime ?? null,
    crawl_age_days: computeCrawlAgeDays(idx.lastCrawlTime ?? null),
    robots_allowed: robotsAllowed,
    indexing_allowed: indexingAllowed,
    google_canonical: googleCanonical,
    user_canonical: userCanonical,
    canonical_mismatch: canonicalMismatch,
    referring_urls: (idx.referringUrls ?? []).slice(0, 5),
    crawled_as: (idx.crawledAs as UrlInspection["crawled_as"]) ?? "MOBILE",
    mobile_usable: mobile ? mobile.verdict === "PASS" : null,
    interpretation: deriveInterpretation(idx),
  };
}
