import { describe, it, expect, vi } from "vitest";
import { detectCannibalization } from "../../src/tools/detect-cannibalization.js";
import { GscApiError } from "../../src/gsc-errors.js";
import { mockClient } from "../helpers/mock-client.js";
import type { SearchAnalyticsResult } from "../../src/gsc-client.js";

import cannibalizationFixture from "../fixtures/live/searchanalytics-cannibalization.json";

describe("detectCannibalization", () => {
  it("detects multi-page cannibalization from fixture data", async () => {
    const client = mockClient({
      querySearchAnalytics: vi.fn().mockResolvedValue(cannibalizationFixture),
    });

    const result = await detectCannibalization(client, "sc-domain:sitefire.ai");

    expect(result.site_url).toBe("sc-domain:sitefire.ai");
    expect(result.period.start).toBeTruthy();
    expect(result.period.end).toBeTruthy();
    expect(result.threshold).toBe(50);

    // "geo optimization" has 3 pages, total impressions = 3200 (above threshold)
    const geoQuery = result.cannibalized_queries.find(
      (q) => q.query === "geo optimization",
    );
    expect(geoQuery).toBeDefined();
    expect(geoQuery!.competing_pages).toHaveLength(3);
    expect(geoQuery!.total_impressions).toBe(3200);

    // Winner should be the page with most clicks (80 clicks)
    expect(geoQuery!.competing_pages[0].page).toBe(
      "https://sitefire.ai/blog/geo-optimization-guide",
    );
    expect(geoQuery!.recommended_action).toContain(
      "https://sitefire.ai/blog/geo-optimization-guide",
    );
    expect(geoQuery!.recommended_action).toContain("redirect others");

    // "sitefire" has 2 pages, total impressions = 2100 (above threshold)
    const sitefireQuery = result.cannibalized_queries.find(
      (q) => q.query === "sitefire",
    );
    expect(sitefireQuery).toBeDefined();
    expect(sitefireQuery!.competing_pages).toHaveLength(2);
    expect(sitefireQuery!.total_impressions).toBe(2100);
    expect(sitefireQuery!.competing_pages[0].page).toBe("https://sitefire.ai/");
  });

  it("sorted by total impressions descending", async () => {
    const client = mockClient({
      querySearchAnalytics: vi.fn().mockResolvedValue(cannibalizationFixture),
    });

    const result = await detectCannibalization(client, "sc-domain:sitefire.ai");

    // "geo optimization" (3200) should come before "sitefire" (2100)
    expect(result.cannibalized_queries.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < result.cannibalized_queries.length; i++) {
      expect(
        result.cannibalized_queries[i - 1].total_impressions,
      ).toBeGreaterThanOrEqual(result.cannibalized_queries[i].total_impressions);
    }
  });

  it("excludes single-page queries (no cannibalization)", async () => {
    const client = mockClient({
      querySearchAnalytics: vi.fn().mockResolvedValue(cannibalizationFixture),
    });

    const result = await detectCannibalization(client, "sc-domain:sitefire.ai");

    // "ai visibility" only appears on 1 page, should not be in results
    const aiVisibility = result.cannibalized_queries.find(
      (q) => q.query === "ai visibility",
    );
    expect(aiVisibility).toBeUndefined();
  });

  it("filters out queries below min_impressions threshold", async () => {
    const client = mockClient({
      querySearchAnalytics: vi.fn().mockResolvedValue(cannibalizationFixture),
    });

    // "sitefire demo" has 2 pages but only 35 total impressions
    const result = await detectCannibalization(client, "sc-domain:sitefire.ai");

    const demoQuery = result.cannibalized_queries.find(
      (q) => q.query === "sitefire demo",
    );
    expect(demoQuery).toBeUndefined();
  });

  it("respects custom min_impressions threshold", async () => {
    const client = mockClient({
      querySearchAnalytics: vi.fn().mockResolvedValue(cannibalizationFixture),
    });

    // With threshold of 10, "sitefire demo" (35 total impressions) should now appear
    const result = await detectCannibalization(
      client,
      "sc-domain:sitefire.ai",
      10,
    );

    expect(result.threshold).toBe(10);
    const demoQuery = result.cannibalized_queries.find(
      (q) => q.query === "sitefire demo",
    );
    expect(demoQuery).toBeDefined();
    expect(demoQuery!.competing_pages).toHaveLength(2);
    expect(demoQuery!.total_impressions).toBe(35);
  });

  it("returns empty cannibalized_queries when no data", async () => {
    const emptyData: SearchAnalyticsResult = { rows: [] };
    const client = mockClient({
      querySearchAnalytics: vi.fn().mockResolvedValue(emptyData),
    });

    const result = await detectCannibalization(client, "sc-domain:sitefire.ai");

    expect(result.cannibalized_queries).toEqual([]);
    expect(result.site_url).toBe("sc-domain:sitefire.ai");
  });

  it("returns empty cannibalized_queries when all queries have only one page", async () => {
    const singlePageData: SearchAnalyticsResult = {
      rows: [
        { keys: ["query-a", "https://sitefire.ai/page-a"], clicks: 50, impressions: 500, ctr: 0.1, position: 3.0 },
        { keys: ["query-b", "https://sitefire.ai/page-b"], clicks: 30, impressions: 300, ctr: 0.1, position: 5.0 },
      ],
    };
    const client = mockClient({
      querySearchAnalytics: vi.fn().mockResolvedValue(singlePageData),
    });

    const result = await detectCannibalization(client, "sc-domain:sitefire.ai");

    expect(result.cannibalized_queries).toEqual([]);
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
      detectCannibalization(client, "sc-domain:nonexistent.com"),
    ).rejects.toThrow(GscApiError);
  });

  it("always includes the anonymization note", async () => {
    // With data
    const client1 = mockClient({
      querySearchAnalytics: vi.fn().mockResolvedValue(cannibalizationFixture),
    });
    const result1 = await detectCannibalization(client1, "sc-domain:sitefire.ai");
    expect(result1.note).toContain("anonymizes");
    expect(result1.note).toContain("long-tail");

    // With empty data
    const client2 = mockClient({
      querySearchAnalytics: vi.fn().mockResolvedValue({ rows: [] }),
    });
    const result2 = await detectCannibalization(client2, "sc-domain:sitefire.ai");
    expect(result2.note).toContain("anonymizes");
    expect(result2.note).toContain("long-tail");
  });

  it("passes correct dimensions and rowLimit to the API", async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = mockClient({ querySearchAnalytics: queryFn });

    await detectCannibalization(client, "sc-domain:sitefire.ai");

    expect(queryFn).toHaveBeenCalledTimes(1);
    const callArgs = queryFn.mock.calls[0];
    expect(callArgs[0]).toBe("sc-domain:sitefire.ai");
    expect(callArgs[1].dimensions).toEqual(["query", "page"]);
    expect(callArgs[1].rowLimit).toBe(1000);
  });
});
