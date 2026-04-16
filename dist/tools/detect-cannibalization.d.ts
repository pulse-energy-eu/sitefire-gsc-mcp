/**
 * detect_cannibalization tool.
 *
 * Answers: "Are multiple pages on my site competing for the same Google query?"
 *
 * Fetches query+page dimension data, groups by query, and identifies
 * queries where 2+ pages compete. Recommends consolidating into the
 * page with the most clicks.
 */
import type { GscClient } from "../gsc-client.js";
import { type DateRange } from "./shared/gsc-dates.js";
export interface CompetingPage {
    page: string;
    clicks: number;
    impressions: number;
    position: number;
}
export interface CannibalizedQuery {
    query: string;
    competing_pages: CompetingPage[];
    total_impressions: number;
    recommended_action: string;
}
export interface CannibalizationReport {
    period: DateRange;
    site_url: string;
    threshold: number;
    cannibalized_queries: CannibalizedQuery[];
    note: string;
}
/**
 * Detect keyword cannibalization for a site.
 *
 * @param client - authenticated GscClient
 * @param siteUrl - the GSC property identifier
 * @param minImpressions - minimum total impressions to consider a query cannibalized (default 50)
 */
export declare function detectCannibalization(client: GscClient, siteUrl: string, minImpressions?: number): Promise<CannibalizationReport>;
//# sourceMappingURL=detect-cannibalization.d.ts.map