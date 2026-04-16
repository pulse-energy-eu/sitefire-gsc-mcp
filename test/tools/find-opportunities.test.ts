import { describe, it, expect, vi } from "vitest";
import { findOpportunities } from "../../src/tools/find-opportunities.js";
import { GscApiError } from "../../src/gsc-errors.js";
import { mockClient } from "../helpers/mock-client.js";
import type { SearchAnalyticsResult } from "../../src/gsc-client.js";

// Rich fixture with a mix of positions, CTRs, and zero-click queries
const richQueryData: SearchAnalyticsResult = {
  rows: [
    // Page 1, high CTR (not low-hanging)
    { keys: ["sitefire"], clicks: 292, impressions: 1850, ctr: 0.1578, position: 1.3 },
    // Page 1, below-average CTR, high impressions (low-hanging fruit)
    { keys: ["geo optimization"], clicks: 10, impressions: 3200, ctr: 0.0031, position: 4.7 },
    // Striking distance (position 11-20)
    { keys: ["ai seo tools"], clicks: 12, impressions: 4500, ctr: 0.0027, position: 14.8 },
    // Striking distance
    { keys: ["generative search optimization"], clicks: 8, impressions: 2800, ctr: 0.0029, position: 12.5 },
    // Zero clicks
    { keys: ["sitefire pricing"], clicks: 0, impressions: 500, ctr: 0, position: 8.2 },
    // Zero clicks
    { keys: ["ai visibility checker"], clicks: 0, impressions: 300, ctr: 0, position: 15.1 },
    // Page 1, decent CTR
    { keys: ["sitefire ai"], clicks: 52, impressions: 890, ctr: 0.0584, position: 2.1 },
  ],
  responseAggregationType: "AUTO",
};

describe("findOpportunities", () => {
  it("produces three opportunity slices from rich data", async () => {
    const client = mockClient({
      querySearchAnalytics: vi.fn().mockResolvedValue(richQueryData),
    });

    const result = await findOpportunities(client, "sc-domain:sitefire.ai");

    expect(result.site_url).toBe("sc-domain:sitefire.ai");
    expect(result.period.start).toBeTruthy();
    expect(result.period.end).toBeTruthy();
    expect(result.empty_state_guidance).toBeNull();

    // Striking distance: only positions 11-20
    expect(result.striking_distance.queries.length).toBeGreaterThan(0);
    for (const q of result.striking_distance.queries) {
      expect(q.position).toBeGreaterThanOrEqual(11);
      expect(q.position).toBeLessThanOrEqual(20);
      expect(q.recommendation).toBeTruthy();
    }

    // Low hanging fruit: high impressions, below-average CTR, page 1
    expect(result.low_hanging_fruit.queries.length).toBeGreaterThan(0);
    for (const q of result.low_hanging_fruit.queries) {
      expect(q.recommendation).toContain("CTR");
    }

    // Zero-click queries
    expect(result.low_click_queries.queries.length).toBeGreaterThan(0);
    for (const q of result.low_click_queries.queries) {
      expect(q.clicks).toBe(0);
      expect(q.impressions).toBeGreaterThan(0);
    }
  });

  it("makes a single API call, not three", async () => {
    const queryFn = vi.fn().mockResolvedValue(richQueryData);
    const client = mockClient({ querySearchAnalytics: queryFn });

    await findOpportunities(client, "sc-domain:sitefire.ai");

    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("striking distance only includes positions 11-20", async () => {
    const client = mockClient({
      querySearchAnalytics: vi.fn().mockResolvedValue(richQueryData),
    });

    const result = await findOpportunities(client, "sc-domain:sitefire.ai");

    const strikingQueries = result.striking_distance.queries.map((q) => q.query);
    expect(strikingQueries).toContain("ai seo tools");
    expect(strikingQueries).toContain("generative search optimization");
    expect(strikingQueries).not.toContain("sitefire"); // position 1.3
  });

  it("zero-click queries filter correctly", async () => {
    const client = mockClient({
      querySearchAnalytics: vi.fn().mockResolvedValue(richQueryData),
    });

    const result = await findOpportunities(client, "sc-domain:sitefire.ai");

    const zeroClickQueries = result.low_click_queries.queries.map((q) => q.query);
    expect(zeroClickQueries).toContain("sitefire pricing");
    expect(zeroClickQueries).not.toContain("sitefire"); // has clicks
  });

  it("returns empty arrays with guidance for zero-data property", async () => {
    const emptyData: SearchAnalyticsResult = { rows: [] };
    const client = mockClient({
      querySearchAnalytics: vi.fn().mockResolvedValue(emptyData),
    });

    const result = await findOpportunities(client, "sc-domain:new-site.com");

    expect(result.striking_distance.queries).toEqual([]);
    expect(result.low_hanging_fruit.queries).toEqual([]);
    expect(result.low_click_queries.queries).toEqual([]);
    expect(result.empty_state_guidance).toContain("No search data");
  });

  it("throws GscApiError on invalid site", async () => {
    const error = new GscApiError(
      "NOT_FOUND",
      "No such property in this Google account. Run list_my_properties.",
      404,
    );
    const client = mockClient({
      querySearchAnalytics: vi.fn().mockRejectedValue(error),
    });

    await expect(
      findOpportunities(client, "sc-domain:nonexistent.com"),
    ).rejects.toThrow(GscApiError);
  });

  it("limits each slice to 15 results", async () => {
    const manyRows: SearchAnalyticsResult = {
      rows: Array.from({ length: 50 }, (_, i) => ({
        keys: [`query-${i}`],
        clicks: 0,
        impressions: 1000 - i * 10,
        ctr: 0,
        position: 15,
      })),
    };
    const client = mockClient({
      querySearchAnalytics: vi.fn().mockResolvedValue(manyRows),
    });

    const result = await findOpportunities(client, "sc-domain:sitefire.ai");

    expect(result.striking_distance.queries.length).toBeLessThanOrEqual(15);
    expect(result.low_click_queries.queries.length).toBeLessThanOrEqual(15);
  });

  it("uses custom days parameter for date range", async () => {
    const queryFn = vi.fn().mockResolvedValue(richQueryData);
    const client = mockClient({ querySearchAnalytics: queryFn });

    const result = await findOpportunities(client, "sc-domain:sitefire.ai", 7);

    // Verify date range is ~7 days (not the default 28)
    const start = new Date(result.period.start);
    const end = new Date(result.period.end);
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(6); // 7 inclusive days = end - start of 6
  });

  it("descriptions and note fields are always present", async () => {
    const client = mockClient({
      querySearchAnalytics: vi.fn().mockResolvedValue({ rows: [] }),
    });

    const result = await findOpportunities(client, "sc-domain:sitefire.ai");

    expect(result.striking_distance.description).toContain("positions 11-20");
    expect(result.low_hanging_fruit.description).toContain("below-average CTR");
    expect(result.low_click_queries.description).toContain("zero clicks");
    expect(result.low_click_queries.note).toContain("privacy");
  });
});
