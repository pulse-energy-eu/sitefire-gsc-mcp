/**
 * traffic_drop_diagnosis tool (composite).
 *
 * Answers: "Why did my Google traffic drop? Is it one query, many
 * queries, a specific page, or everything?"
 *
 * Makes 4 parallel searchAnalytics.query calls via Promise.allSettled
 * (current/previous x query/page dimensions), then attributes the root
 * cause of any traffic decline.
 */
import type { GscClient } from "../gsc-client.js";
import { type DateRange } from "./shared/gsc-dates.js";
import type { QueryMetrics, PageMetrics } from "./shared/query-types.js";
export type ComparePeriod = "wow" | "mom";
export type RootCause = "query_loss" | "rank_drop" | "coverage_loss" | "seasonal" | "none";
export interface Delta {
    clicks: number;
    impressions: number;
    position: number;
}
export interface DropDiagnosis {
    site_url: string;
    compare: {
        current_period: DateRange;
        previous_period: DateRange;
    };
    overall_change: {
        clicks: number;
        impressions: number;
        position: number;
    };
    root_cause_attribution: {
        primary: RootCause;
        confidence: "high" | "medium" | "low";
        explanation: string;
    };
    top_query_losses: Array<QueryMetrics & {
        delta: Delta;
    }>;
    top_page_losses: Array<PageMetrics & {
        delta: Delta;
    }>;
    partial_failures?: string[];
    note: string;
}
export declare function trafficDropDiagnosis(client: GscClient, siteUrl: string, comparePeriod?: ComparePeriod): Promise<DropDiagnosis>;
//# sourceMappingURL=traffic-drop-diagnosis.d.ts.map