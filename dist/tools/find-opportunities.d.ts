/**
 * find_opportunities tool (composite).
 *
 * Answers: "What should I focus on to grow my Google traffic?"
 * Returns three opportunity slices in one response:
 * - striking_distance: queries at positions 11-20
 * - low_hanging_fruit: high impressions, below-average CTR
 * - low_click_queries: impressions but zero clicks
 *
 * Single API call, three client-side filters.
 */
import type { GscClient } from "../gsc-client.js";
import { type DateRange } from "./shared/gsc-dates.js";
import type { QueryMetrics, RecommendedQuery } from "./shared/query-types.js";
export interface Opportunities {
    period: DateRange;
    site_url: string;
    striking_distance: {
        description: string;
        queries: RecommendedQuery[];
    };
    low_hanging_fruit: {
        description: string;
        queries: RecommendedQuery[];
    };
    low_click_queries: {
        description: string;
        note: string;
        queries: QueryMetrics[];
    };
    empty_state_guidance: string | null;
}
export declare function findOpportunities(client: GscClient, siteUrl: string, days?: number): Promise<Opportunities>;
//# sourceMappingURL=find-opportunities.d.ts.map