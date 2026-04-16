import { describe, it, expect, vi } from "vitest";
import {
  trafficDropDiagnosis,
  type DropDiagnosis,
} from "../../src/tools/traffic-drop-diagnosis.js";
import { GscApiError } from "../../src/gsc-errors.js";
import { mockClient } from "../helpers/mock-client.js";
import type { SearchAnalyticsResult, SearchAnalyticsQuery } from "../../src/gsc-client.js";

// Fixtures matching the spec: previous period has more traffic
import dropCurrent from "../fixtures/live/searchanalytics-drop-current.json";
import dropPrevious from "../fixtures/live/searchanalytics-drop-previous.json";

// Page-dimension equivalents (reuse same shape, different keys)
const pageDropCurrent: SearchAnalyticsResult = {
  rows: [
    { keys: ["https://sitefire.ai/"], clicks: 150, impressions: 1200, ctr: 0.125, position: 2.1 },
    { keys: ["https://sitefire.ai/geo"], clicks: 40, impressions: 1800, ctr: 0.022, position: 6.5 },
  ],
};
const pageDropPrevious: SearchAnalyticsResult = {
  rows: [
    { keys: ["https://sitefire.ai/"], clicks: 292, impressions: 1850, ctr: 0.1578, position: 1.3 },
    { keys: ["https://sitefire.ai/geo"], clicks: 145, impressions: 3200, ctr: 0.0453, position: 4.7 },
  ],
};

/**
 * Build mock that returns responses in Promise.allSettled order:
 * [currentQuery, prevQuery, currentPage, prevPage].
 */
function buildOrderedMock(
  currentQuery: SearchAnalyticsResult,
  previousQuery: SearchAnalyticsResult,
  currentPage: SearchAnalyticsResult = pageDropCurrent,
  previousPage: SearchAnalyticsResult = pageDropPrevious,
) {
  let callIndex = 0;
  const responses = [currentQuery, previousQuery, currentPage, previousPage];
  return vi.fn().mockImplementation(() => {
    const response = responses[callIndex % responses.length];
    callIndex++;
    return Promise.resolve(response);
  });
}

describe("trafficDropDiagnosis", () => {
  it("diagnoses query_loss when a few queries account for most click loss", async () => {
    const queryFn = buildOrderedMock(
      dropCurrent as SearchAnalyticsResult,
      dropPrevious as SearchAnalyticsResult,
    );
    const client = mockClient({ querySearchAnalytics: queryFn });

    const result = await trafficDropDiagnosis(client, "sc-domain:sitefire.ai");

    expect(result.site_url).toBe("sc-domain:sitefire.ai");
    expect(result.overall_change.clicks).toBeLessThan(0);
    expect(result.root_cause_attribution.primary).toBe("query_loss");
    expect(result.root_cause_attribution.confidence).toBe("high");
    expect(result.root_cause_attribution.explanation).toContain("queries");
    expect(result.top_query_losses.length).toBeGreaterThan(0);

    // Each query loss should have delta fields
    for (const q of result.top_query_losses) {
      expect(q.delta).toBeDefined();
      expect(q.delta.clicks).toBeLessThan(0);
      expect(typeof q.delta.impressions).toBe("number");
      expect(typeof q.delta.position).toBe("number");
    }

    // Page losses should also be populated
    expect(result.top_page_losses.length).toBeGreaterThan(0);
    for (const p of result.top_page_losses) {
      expect(p.page).toBeTruthy();
      expect(p.delta.clicks).toBeLessThan(0);
    }

    // Note must always be present
    expect(result.note).toContain("freshness lag");
  });

  it("diagnoses rank_drop when positions worsen broadly", async () => {
    // Many queries all dropped in position by >2 but clicks spread across them
    const currentRankDrop: SearchAnalyticsResult = {
      rows: Array.from({ length: 20 }, (_, i) => ({
        keys: [`query-${i}`],
        clicks: 5,
        impressions: 200,
        ctr: 0.025,
        position: 12 + i * 0.5, // positions 12-21.5
      })),
    };
    const previousRankDrop: SearchAnalyticsResult = {
      rows: Array.from({ length: 20 }, (_, i) => ({
        keys: [`query-${i}`],
        clicks: 10,
        impressions: 250,
        ctr: 0.04,
        position: 5 + i * 0.3, // positions 5-10.7
      })),
    };

    const queryFn = buildOrderedMock(
      currentRankDrop,
      previousRankDrop,
      // page data mirrors the same pattern
      currentRankDrop,
      previousRankDrop,
    );
    const client = mockClient({ querySearchAnalytics: queryFn });

    const result = await trafficDropDiagnosis(client, "sc-domain:sitefire.ai");

    expect(result.overall_change.clicks).toBeLessThan(0);
    expect(result.root_cause_attribution.primary).toBe("rank_drop");
    expect(result.root_cause_attribution.confidence).toBe("medium");
    expect(result.root_cause_attribution.explanation).toContain("position");
  });

  it("reports no drop when traffic is flat or growing", async () => {
    // Current period has more clicks than previous
    const currentFlat: SearchAnalyticsResult = {
      rows: [
        { keys: ["sitefire"], clicks: 300, impressions: 2000, ctr: 0.15, position: 1.5 },
        { keys: ["geo seo"], clicks: 150, impressions: 3000, ctr: 0.05, position: 4.0 },
      ],
    };
    const previousFlat: SearchAnalyticsResult = {
      rows: [
        { keys: ["sitefire"], clicks: 290, impressions: 1900, ctr: 0.153, position: 1.6 },
        { keys: ["geo seo"], clicks: 140, impressions: 2800, ctr: 0.05, position: 4.2 },
      ],
    };

    const queryFn = buildOrderedMock(currentFlat, previousFlat, currentFlat, previousFlat);
    const client = mockClient({ querySearchAnalytics: queryFn });

    const result = await trafficDropDiagnosis(client, "sc-domain:sitefire.ai");

    expect(result.overall_change.clicks).toBeGreaterThanOrEqual(0);
    expect(result.root_cause_attribution.primary).toBe("none");
    expect(result.root_cause_attribution.confidence).toBe("high");
    expect(result.root_cause_attribution.explanation).toContain("No traffic drop");
  });

  it("handles new property with empty data for both periods", async () => {
    const emptyData: SearchAnalyticsResult = { rows: [] };
    const queryFn = buildOrderedMock(emptyData, emptyData, emptyData, emptyData);
    const client = mockClient({ querySearchAnalytics: queryFn });

    const result = await trafficDropDiagnosis(client, "sc-domain:brand-new.com");

    expect(result.root_cause_attribution.primary).toBe("none");
    expect(result.root_cause_attribution.explanation).toContain("No search data");
    expect(result.top_query_losses).toEqual([]);
    expect(result.top_page_losses).toEqual([]);
    expect(result.note).toBeTruthy();
  });

  it("throws GscApiError when all 4 calls fail (invalid site)", async () => {
    const error = new GscApiError(
      "NOT_FOUND",
      "No such property in this Google account. Run list_my_properties.",
      404,
    );
    const client = mockClient({
      querySearchAnalytics: vi.fn().mockRejectedValue(error),
    });

    await expect(
      trafficDropDiagnosis(client, "sc-domain:nonexistent.com"),
    ).rejects.toThrow(GscApiError);
  });

  it("makes exactly 4 parallel API calls", async () => {
    const emptyData: SearchAnalyticsResult = { rows: [] };
    const queryFn = vi.fn().mockResolvedValue(emptyData);
    const client = mockClient({ querySearchAnalytics: queryFn });

    await trafficDropDiagnosis(client, "sc-domain:sitefire.ai");

    expect(queryFn).toHaveBeenCalledTimes(4);
  });

  it("accepts compare_period parameter without error", async () => {
    const emptyData: SearchAnalyticsResult = { rows: [] };
    const queryFn = vi.fn().mockResolvedValue(emptyData);
    const client = mockClient({ querySearchAnalytics: queryFn });

    // "mom" should work the same as "wow" (both use gscComparisonRanges)
    const result = await trafficDropDiagnosis(
      client,
      "sc-domain:sitefire.ai",
      "mom",
    );

    expect(result.compare.current_period.start).toBeTruthy();
    expect(result.compare.previous_period.start).toBeTruthy();
    expect(queryFn).toHaveBeenCalledTimes(4);
  });

  it("includes compare period date ranges", async () => {
    const emptyData: SearchAnalyticsResult = { rows: [] };
    const queryFn = vi.fn().mockResolvedValue(emptyData);
    const client = mockClient({ querySearchAnalytics: queryFn });

    const result = await trafficDropDiagnosis(client, "sc-domain:sitefire.ai");

    // Verify period structure
    expect(result.compare.current_period.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.compare.current_period.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.compare.previous_period.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.compare.previous_period.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Previous period should end before current period starts
    expect(result.compare.previous_period.end < result.compare.current_period.start).toBe(true);
  });

  it("populates partial_failures when some calls fail", async () => {
    const error = new Error("Timeout on this one");
    let callCount = 0;
    const queryFn = vi.fn().mockImplementation(() => {
      callCount++;
      // Let the first two succeed (current/previous query), fail the last two (pages)
      if (callCount <= 2) {
        return Promise.resolve(dropCurrent as SearchAnalyticsResult);
      }
      return Promise.reject(error);
    });
    const client = mockClient({ querySearchAnalytics: queryFn });

    const result = await trafficDropDiagnosis(client, "sc-domain:sitefire.ai");

    // Should not throw, but should have partial_failures
    expect(result.partial_failures).toBeDefined();
    expect(result.partial_failures!.length).toBe(2);
    expect(result.partial_failures![0]).toContain("current pages");
    expect(result.partial_failures![1]).toContain("previous pages");
  });

  it("diagnoses coverage_loss when impressions drop but position is stable", async () => {
    const currentCoverage: SearchAnalyticsResult = {
      rows: Array.from({ length: 15 }, (_, i) => ({
        keys: [`query-${i}`],
        clicks: 4,
        impressions: 60,
        ctr: 0.067,
        position: 5.0 + i * 0.1,
      })),
    };
    const previousCoverage: SearchAnalyticsResult = {
      rows: Array.from({ length: 15 }, (_, i) => ({
        keys: [`query-${i}`],
        clicks: 8,
        impressions: 200,
        ctr: 0.04,
        position: 5.0 + i * 0.1, // same positions
      })),
    };

    const queryFn = buildOrderedMock(
      currentCoverage,
      previousCoverage,
      currentCoverage,
      previousCoverage,
    );
    const client = mockClient({ querySearchAnalytics: queryFn });

    const result = await trafficDropDiagnosis(client, "sc-domain:sitefire.ai");

    expect(result.overall_change.clicks).toBeLessThan(0);
    expect(result.root_cause_attribution.primary).toBe("coverage_loss");
    expect(result.root_cause_attribution.confidence).toBe("medium");
    expect(result.root_cause_attribution.explanation).toContain("deindexed");
  });

  it("diagnoses seasonal when clicks and impressions drop proportionally", async () => {
    const currentSeasonal: SearchAnalyticsResult = {
      rows: Array.from({ length: 20 }, (_, i) => ({
        keys: [`query-${i}`],
        clicks: 8,
        impressions: 160,
        ctr: 0.05,
        position: 5.0 + i * 0.1,
      })),
    };
    const previousSeasonal: SearchAnalyticsResult = {
      rows: Array.from({ length: 20 }, (_, i) => ({
        keys: [`query-${i}`],
        clicks: 10,
        impressions: 200,
        ctr: 0.05,
        position: 5.0 + i * 0.1, // same positions
      })),
    };

    const queryFn = buildOrderedMock(
      currentSeasonal,
      previousSeasonal,
      currentSeasonal,
      previousSeasonal,
    );
    const client = mockClient({ querySearchAnalytics: queryFn });

    const result = await trafficDropDiagnosis(client, "sc-domain:sitefire.ai");

    expect(result.overall_change.clicks).toBeLessThan(0);
    expect(result.root_cause_attribution.primary).toBe("seasonal");
    expect(result.root_cause_attribution.confidence).toBe("low");
    expect(result.root_cause_attribution.explanation).toContain("seasonal");
  });

  it("note about GSC freshness lag is always present", async () => {
    const emptyData: SearchAnalyticsResult = { rows: [] };
    const queryFn = vi.fn().mockResolvedValue(emptyData);
    const client = mockClient({ querySearchAnalytics: queryFn });

    const result = await trafficDropDiagnosis(client, "sc-domain:sitefire.ai");

    expect(result.note).toContain("2-3 day freshness lag");
    expect(result.note).toContain("sampled");
  });
});
