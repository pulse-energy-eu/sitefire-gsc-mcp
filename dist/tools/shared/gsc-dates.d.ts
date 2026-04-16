/**
 * Shared date-range utilities for GSC tools.
 *
 * GSC data has a 2-3 day freshness lag. All tools use the same
 * "end = today minus lag, start = end minus window" pattern.
 */
export interface DateRange {
    start: string;
    end: string;
}
export declare function isoDate(d: Date): string;
/**
 * Build a GSC-compatible date range.
 * @param days - window size in days (default 28)
 * @param lagDays - freshness lag (default 3)
 */
export declare function gscDateRange(days?: number, lagDays?: number): DateRange;
/**
 * Build two adjacent date ranges for comparison (current vs previous).
 * Used by traffic-drop-diagnosis and weekly-report wow_delta.
 */
export declare function gscComparisonRanges(days?: number, lagDays?: number): {
    current: DateRange;
    previous: DateRange;
};
//# sourceMappingURL=gsc-dates.d.ts.map