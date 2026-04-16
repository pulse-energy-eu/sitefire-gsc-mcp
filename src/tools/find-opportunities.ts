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

import type { GscClient, SearchAnalyticsRow } from "../gsc-client.js";
import { type GscApiError } from "../gsc-errors.js";
import { gscDateRange, type DateRange } from "./shared/gsc-dates.js";
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

function toQueryMetrics(row: SearchAnalyticsRow): QueryMetrics {
  return {
    query: row.keys[0] ?? "",
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
  };
}

function selectStrikingDistance(rows: SearchAnalyticsRow[]): RecommendedQuery[] {
  return rows
    .filter((r) => r.position >= 11 && r.position <= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 15)
    .map((r) => ({
      ...toQueryMetrics(r),
      recommendation: `Ranking at position ${r.position.toFixed(1)} with ${r.impressions} impressions. Improve content depth or build links to push onto page 1.`,
    }));
}

function selectLowHangingFruit(rows: SearchAnalyticsRow[]): RecommendedQuery[] {
  if (rows.length === 0) return [];

  const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
  const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0);
  const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
  const medianImpressions = getMedianImpressions(rows);

  return rows
    .filter(
      (r) =>
        r.impressions > medianImpressions &&
        r.ctr < avgCtr &&
        r.position <= 10,
    )
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 15)
    .map((r) => ({
      ...toQueryMetrics(r),
      recommendation: `CTR of ${(r.ctr * 100).toFixed(1)}% is below your site average of ${(avgCtr * 100).toFixed(1)}%. Rewrite the meta title and description to better match this query.`,
    }));
}

function selectZeroClick(rows: SearchAnalyticsRow[]): QueryMetrics[] {
  return rows
    .filter((r) => r.clicks === 0 && r.impressions > 0)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 15)
    .map(toQueryMetrics);
}

function getMedianImpressions(rows: SearchAnalyticsRow[]): number {
  const sorted = rows.map((r) => r.impressions).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export async function findOpportunities(
  client: GscClient,
  siteUrl: string,
  days: number = 28,
): Promise<Opportunities> {
  const period = gscDateRange(days);

  // Single API call, three client-side filters
  let rows: SearchAnalyticsRow[];
  try {
    const result = await client.querySearchAnalytics(siteUrl, {
      startDate: period.start,
      endDate: period.end,
      dimensions: ["query"],
      rowLimit: 1000,
    });
    rows = result.rows;
  } catch (err) {
    throw err as GscApiError;
  }

  const strikingQueries = selectStrikingDistance(rows);
  const lowHangingQueries = selectLowHangingFruit(rows);
  const zeroClickQueries = selectZeroClick(rows);

  const allEmpty =
    strikingQueries.length === 0 &&
    lowHangingQueries.length === 0 &&
    zeroClickQueries.length === 0;

  return {
    period,
    site_url: siteUrl,
    striking_distance: {
      description:
        "Queries ranking at positions 11-20. One click-through-rate jump away from page 1.",
      queries: strikingQueries,
    },
    low_hanging_fruit: {
      description:
        "High-impression queries with below-average CTR. Meta title/description rewrites likely win.",
      queries: lowHangingQueries,
    },
    low_click_queries: {
      description:
        "Queries with impressions but zero clicks. Either content mismatch or SERP feature ate the click.",
      note: "GSC hides queries that received fewer than ~10 daily searches due to user-privacy thresholds. These aren't in this list.",
      queries: zeroClickQueries,
    },
    empty_state_guidance: allEmpty
      ? "No search data available yet. This property may be too new for Google to have collected data. Run setup_check for a status summary, or come back in a few days."
      : null,
  };
}
