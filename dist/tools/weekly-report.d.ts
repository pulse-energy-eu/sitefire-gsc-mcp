/**
 * weekly_report tool (composite).
 *
 * Answers: "How is my site doing on Google this week?"
 * Fires five GSC calls in parallel via Promise.allSettled, aggregates
 * into a single report. Partial failures are captured in the
 * partial_failures array rather than failing the entire tool.
 */
import type { GscClient } from "../gsc-client.js";
import type { QueryMetrics, PageMetrics } from "./shared/query-types.js";
export interface WeeklyReport {
    period: {
        start: string;
        end: string;
    };
    site_url: string;
    is_new_property: boolean;
    rollup: {
        clicks: number;
        impressions: number;
        ctr: number;
        avg_position: number;
        queries_count: number;
        pages_count: number;
    } | null;
    wow_delta: {
        clicks: number;
        impressions: number;
        ctr: number;
        avg_position: number;
    } | null;
    top_queries: QueryMetrics[];
    top_pages: PageMetrics[];
    sitemap_count: number;
    sitemap_health: {
        errors: number;
        warnings: number;
        last_downloaded: string | null;
    };
    partial_failures: string[];
    empty_state_guidance: string | null;
}
/**
 * Build the weekly report for a given site.
 * Errors from GscClient propagate naturally for invalid sites (NOT_FOUND, etc.).
 * For the five parallel calls, partial failures are captured rather than thrown.
 */
export declare function weeklyReport(client: GscClient, siteUrl: string, days?: number): Promise<WeeklyReport>;
//# sourceMappingURL=weekly-report.d.ts.map