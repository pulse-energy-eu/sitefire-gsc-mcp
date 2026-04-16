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

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Build a GSC-compatible date range.
 * @param days - window size in days (default 28)
 * @param lagDays - freshness lag (default 3)
 */
export function gscDateRange(days: number = 28, lagDays: number = 3): DateRange {
  const end = new Date();
  end.setDate(end.getDate() - lagDays);
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return { start: isoDate(start), end: isoDate(end) };
}

/**
 * Build two adjacent date ranges for comparison (current vs previous).
 * Used by traffic-drop-diagnosis and weekly-report wow_delta.
 */
export function gscComparisonRanges(
  days: number = 28,
  lagDays: number = 3,
): { current: DateRange; previous: DateRange } {
  const current = gscDateRange(days, lagDays);
  const prevEnd = new Date(current.start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - days);
  return {
    current,
    previous: { start: isoDate(prevStart), end: isoDate(prevEnd) },
  };
}
