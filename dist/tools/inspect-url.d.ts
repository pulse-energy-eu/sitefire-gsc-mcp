/**
 * inspect_url tool.
 *
 * Answers: "What does Google know about this specific URL?"
 * Calls urlInspection.index.inspect() and returns a structured
 * inspection result with an interpretation layer.
 */
import type { GscClient } from "../gsc-client.js";
export type InspectionState = "indexed" | "crawled_not_indexed" | "canonical_mismatch" | "blocked" | "unknown";
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
export declare function inspectUrlTool(client: GscClient, siteUrl: string, url: string): Promise<UrlInspection>;
//# sourceMappingURL=inspect-url.d.ts.map