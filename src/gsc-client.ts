/**
 * Google Search Console API client wrapper.
 *
 * Uses the googleapis npm package. Provides typed methods for the four
 * endpoints we use: sites.list, searchAnalytics.query,
 * urlInspection.index.inspect, sitemaps.list.
 *
 * All errors are translated through gsc-errors.ts. 5xx errors get
 * one automatic retry after 250ms.
 */

import { google, type webmasters_v3, type searchconsole_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { translateError, ReauthRequired, type GscApiError } from "./gsc-errors.js";
import { deleteToken } from "./auth.js";

const RETRY_DELAY_MS = 250;

export interface SiteEntry {
  siteUrl: string;
  permissionLevel: string;
}

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchAnalyticsResult {
  rows: SearchAnalyticsRow[];
  responseAggregationType?: string;
}

export interface SitemapEntry {
  path: string;
  lastSubmitted?: string;
  lastDownloaded?: string;
  warnings?: string;
  errors?: string;
  isPending?: boolean;
  contents?: Array<{
    type: string;
    submitted: string;
    indexed: string;
  }>;
}

export interface UrlInspectionResult {
  inspectionResult: {
    indexStatusResult: {
      verdict: string;
      coverageState: string;
      robotsTxtState?: string;
      indexingState?: string;
      lastCrawlTime?: string;
      pageFetchState?: string;
      googleCanonical?: string;
      userCanonical?: string;
      referringUrls?: string[];
      crawledAs?: string;
    };
    mobileUsabilityResult?: {
      verdict: string;
      issues?: Array<{ issueType: string; message: string }>;
    };
    richResultsResult?: {
      verdict: string;
      detectedItems?: Array<{ richResultType: string }>;
    };
  };
}

export interface SearchAnalyticsQuery {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  rowLimit?: number;
  startRow?: number;
  dataState?: "all" | "final";
  dimensionFilterGroups?: Array<{
    groupType?: string;
    filters: Array<{
      dimension: string;
      operator?: string;
      expression?: string;
    }>;
  }>;
}

/**
 * Wrapper around the Google Search Console API.
 */
export class GscClient {
  private webmasters: webmasters_v3.Webmasters;
  private searchconsole: searchconsole_v1.Searchconsole;

  constructor(auth: OAuth2Client) {
    this.webmasters = google.webmasters({ version: "v3", auth });
    this.searchconsole = google.searchconsole({ version: "v1", auth });
  }

  /**
   * List all properties accessible to this account.
   */
  async listSites(): Promise<SiteEntry[]> {
    return this.withRetry(async () => {
      try {
        const res = await this.webmasters.sites.list();
        const entries = res.data.siteEntry ?? [];
        return entries.map((e) => ({
          siteUrl: e.siteUrl ?? "",
          permissionLevel: e.permissionLevel ?? "unknown",
        }));
      } catch (err) {
        throw this.handleError(err);
      }
    });
  }

  /**
   * Query search analytics data (the Performance report).
   */
  async querySearchAnalytics(
    siteUrl: string,
    query: SearchAnalyticsQuery,
  ): Promise<SearchAnalyticsResult> {
    return this.withRetry(async () => {
      try {
        const res = await this.webmasters.searchanalytics.query({
          siteUrl,
          requestBody: {
            startDate: query.startDate,
            endDate: query.endDate,
            dimensions: query.dimensions,
            rowLimit: query.rowLimit ?? 1000,
            startRow: query.startRow,
            dataState: query.dataState ?? "final",
            dimensionFilterGroups: query.dimensionFilterGroups,
          },
        });
        const rows = (res.data.rows ?? []).map((r) => ({
          keys: r.keys ?? [],
          clicks: r.clicks ?? 0,
          impressions: r.impressions ?? 0,
          ctr: r.ctr ?? 0,
          position: r.position ?? 0,
        }));
        return {
          rows,
          responseAggregationType: res.data.responseAggregationType ?? undefined,
        };
      } catch (err) {
        throw this.handleError(err, { siteUrl });
      }
    });
  }

  /**
   * Inspect a URL's index status.
   */
  async inspectUrl(siteUrl: string, inspectionUrl: string): Promise<UrlInspectionResult> {
    return this.withRetry(async () => {
      try {
        const res = await this.searchconsole.urlInspection.index.inspect({
          requestBody: {
            inspectionUrl,
            siteUrl,
            languageCode: "en-US",
          },
        });

        const idx = res.data.inspectionResult?.indexStatusResult ?? {};
        const mobile = res.data.inspectionResult?.mobileUsabilityResult;
        const rich = res.data.inspectionResult?.richResultsResult;

        return {
          inspectionResult: {
            indexStatusResult: {
              verdict: idx.verdict ?? "NEUTRAL",
              coverageState: idx.coverageState ?? "Unknown",
              robotsTxtState: idx.robotsTxtState ?? undefined,
              indexingState: idx.indexingState ?? undefined,
              lastCrawlTime: idx.lastCrawlTime ?? undefined,
              pageFetchState: idx.pageFetchState ?? undefined,
              googleCanonical: idx.googleCanonical ?? undefined,
              userCanonical: idx.userCanonical ?? undefined,
              referringUrls: (idx.referringUrls ?? []) as string[],
              crawledAs: idx.crawledAs ?? undefined,
            },
            mobileUsabilityResult: mobile
              ? {
                  verdict: mobile.verdict ?? "NEUTRAL",
                  issues: mobile.issues?.map((i) => ({
                    issueType: i.issueType ?? "",
                    message: i.message ?? "",
                  })),
                }
              : undefined,
            richResultsResult: rich
              ? {
                  verdict: rich.verdict ?? "NEUTRAL",
                  detectedItems: rich.detectedItems?.map((d) => ({
                    richResultType: d.richResultType ?? "",
                  })),
                }
              : undefined,
          },
        };
      } catch (err) {
        throw this.handleError(err, { siteUrl, url: inspectionUrl });
      }
    });
  }

  /**
   * List sitemaps for a property.
   */
  async listSitemaps(siteUrl: string): Promise<SitemapEntry[]> {
    return this.withRetry(async () => {
      try {
        const res = await this.webmasters.sitemaps.list({ siteUrl });
        const sitemaps = res.data.sitemap ?? [];
        return sitemaps.map((s) => ({
          path: s.path ?? "",
          lastSubmitted: s.lastSubmitted ?? undefined,
          lastDownloaded: s.lastDownloaded ?? undefined,
          warnings: s.warnings ?? undefined,
          errors: s.errors ?? undefined,
          isPending: s.isPending ?? undefined,
          contents: s.contents?.map((c) => ({
            type: c.type ?? "",
            submitted: c.submitted ?? "0",
            indexed: c.indexed ?? "0",
          })),
        }));
      } catch (err) {
        throw this.handleError(err, { siteUrl });
      }
    });
  }

  private handleError(err: unknown, context?: { siteUrl?: string; url?: string }): GscApiError {
    const translated = translateError(err, context);
    if (translated instanceof ReauthRequired) {
      deleteToken();
    }
    return translated;
  }

  /**
   * Retry once on 5xx after RETRY_DELAY_MS.
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Error && "code" in err) {
        const code = (err as { code?: number }).code;
        if (code && code >= 500) {
          await sleep(RETRY_DELAY_MS);
          return fn();
        }
      }
      // Check if it's a translated GscApiError with 5xx
      if (err instanceof Error && err.name === "GscApiError") {
        const apiErr = err as GscApiError;
        if (apiErr.httpStatus && apiErr.httpStatus >= 500) {
          await sleep(RETRY_DELAY_MS);
          return fn();
        }
      }
      throw err;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
