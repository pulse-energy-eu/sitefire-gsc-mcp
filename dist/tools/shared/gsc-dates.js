/**
 * Shared date-range utilities for GSC tools.
 *
 * GSC data has a 2-3 day freshness lag. All tools use the same
 * "end = today minus lag, start = end minus window" pattern.
 */
export function isoDate(d) {
    return d.toISOString().slice(0, 10);
}
/**
 * Build a GSC-compatible date range.
 * @param days - window size in days (default 28)
 * @param lagDays - freshness lag (default 3)
 */
export function gscDateRange(days = 28, lagDays = 3) {
    const end = new Date();
    end.setDate(end.getDate() - lagDays);
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));
    return { start: isoDate(start), end: isoDate(end) };
}
/**
 * Build two adjacent date ranges for comparison (current vs previous).
 * Used by traffic-drop-diagnosis and weekly-report wow_delta.
 */
export function gscComparisonRanges(days = 28, lagDays = 3) {
    const current = gscDateRange(days, lagDays);
    const prevEnd = new Date(current.start);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - (days - 1));
    return {
        current,
        previous: { start: isoDate(prevStart), end: isoDate(prevEnd) },
    };
}
//# sourceMappingURL=gsc-dates.js.map