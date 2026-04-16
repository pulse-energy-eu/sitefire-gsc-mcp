/**
 * Shared query/page row types used across multiple tools.
 */

export interface QueryMetrics {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface PageMetrics {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export type RecommendedQuery = QueryMetrics & { recommendation: string };
