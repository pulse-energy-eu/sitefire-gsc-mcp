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
import type { OAuth2Client } from "google-auth-library";
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
            issues?: Array<{
                issueType: string;
                message: string;
            }>;
        };
        richResultsResult?: {
            verdict: string;
            detectedItems?: Array<{
                richResultType: string;
            }>;
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
export declare class GscClient {
    private webmasters;
    private searchconsole;
    constructor(auth: OAuth2Client);
    /**
     * List all properties accessible to this account.
     */
    listSites(): Promise<SiteEntry[]>;
    /**
     * Query search analytics data (the Performance report).
     */
    querySearchAnalytics(siteUrl: string, query: SearchAnalyticsQuery): Promise<SearchAnalyticsResult>;
    /**
     * Inspect a URL's index status.
     */
    inspectUrl(siteUrl: string, inspectionUrl: string): Promise<UrlInspectionResult>;
    /**
     * List sitemaps for a property.
     */
    listSitemaps(siteUrl: string): Promise<SitemapEntry[]>;
    private handleError;
    /**
     * Retry once on 5xx after RETRY_DELAY_MS.
     */
    private withRetry;
}
//# sourceMappingURL=gsc-client.d.ts.map