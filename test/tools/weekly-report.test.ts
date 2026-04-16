import { describe, it, expect, vi } from "vitest";
import { weeklyReport } from "../../src/tools/weekly-report.js";
import { GscApiError } from "../../src/gsc-errors.js";
import { mockClient } from "../helpers/mock-client.js";
import type { SearchAnalyticsResult, SitemapEntry } from "../../src/gsc-client.js";

// Fixtures matching test/fixtures/live shapes
import aggregateFixture from "../fixtures/live/searchanalytics-aggregate.json";
import byQueryFixture from "../fixtures/live/searchanalytics-by-query.json";
import byPageFixture from "../fixtures/live/searchanalytics-by-page.json";
import sitemapsFixture from "../fixtures/live/sitemaps-list.json";

// Typed fixture data
const currentAggregate: SearchAnalyticsResult = aggregateFixture;
const previousAggregate: SearchAnalyticsResult = {
  rows: [
    { keys: [], clicks: 1600, impressions: 25000, ctr: 0.064, position: 13.1 },
  ],
};
const byQueryData: SearchAnalyticsResult = byQueryFixture;
const byPageData: SearchAnalyticsResult = byPageFixture;
const sitemapsList: SitemapEntry[] = sitemapsFixture.sitemap.map((s) => ({
  path: s.path,
  lastSubmitted: s.lastSubmitted,
  lastDownloaded: s.lastDownloaded,
  isPending: s.isPending,
  warnings: s.warnings,
  errors: s.errors,
  contents: s.contents,
}));

/**
 * Build a mock client whose querySearchAnalytics resolves differently
 * depending on the call order: current agg, previous agg, by-query, by-page.
 */
function buildHappyClient() {
  let callIndex = 0;
  const queryFn = vi.fn().mockImplementation(() => {
    const responses = [currentAggregate, previousAggregate, byQueryData, byPageData];
    return Promise.resolve(responses[callIndex++]);
  });
  return mockClient({
    querySearchAnalytics: queryFn,
    listSitemaps: vi.fn().mockResolvedValue(sitemapsList),
  });
}

describe("weeklyReport", () => {
  describe("happy path", () => {
    it("returns a complete report when all 5 calls succeed", async () => {
      const client = buildHappyClient();
      const result = await weeklyReport(client, "sc-domain:sitefire.ai");

      // Period
      expect(result.period.start).toBeTruthy();
      expect(result.period.end).toBeTruthy();
      expect(result.site_url).toBe("sc-domain:sitefire.ai");
      expect(result.is_new_property).toBe(false);
      expect(result.empty_state_guidance).toBeNull();
      expect(result.partial_failures).toEqual([]);

      // Rollup
      expect(result.rollup).not.toBeNull();
      expect(result.rollup!.clicks).toBe(1842);
      expect(result.rollup!.impressions).toBe(28450);
      expect(result.rollup!.ctr).toBe(0.0647);
      expect(result.rollup!.avg_position).toBe(12.3);
      expect(result.rollup!.queries_count).toBe(5);
      expect(result.rollup!.pages_count).toBe(3);

      // WoW delta
      expect(result.wow_delta).not.toBeNull();
      expect(result.wow_delta!.clicks).toBeCloseTo((1842 - 1600) / 1600, 4);
      expect(result.wow_delta!.impressions).toBeCloseTo((28450 - 25000) / 25000, 4);
      expect(result.wow_delta!.ctr).toBeCloseTo(0.0647 - 0.064, 4);
      expect(result.wow_delta!.avg_position).toBeCloseTo(12.3 - 13.1, 4);

      // Top queries
      expect(result.top_queries).toHaveLength(5);
      expect(result.top_queries[0].query).toBe("sitefire");
      expect(result.top_queries[0].clicks).toBe(292);

      // Top pages
      expect(result.top_pages).toHaveLength(3);
      expect(result.top_pages[0].page).toBe("https://sitefire.ai/");

      // Sitemaps
      expect(result.sitemap_count).toBe(1);
      expect(result.sitemap_health.errors).toBe(0);
      expect(result.sitemap_health.warnings).toBe(0);
      expect(result.sitemap_health.last_downloaded).toBe("2026-04-14T12:15:00.000Z");
    });

    it("fires exactly 5 parallel calls", async () => {
      const client = buildHappyClient();
      await weeklyReport(client, "sc-domain:sitefire.ai");

      expect(client.querySearchAnalytics).toHaveBeenCalledTimes(4);
      expect(client.listSitemaps).toHaveBeenCalledTimes(1);
    });
  });

  describe("partial failures", () => {
    it("captures 1-of-5 failure in partial_failures, rest intact", async () => {
      let callIndex = 0;
      const queryFn = vi.fn().mockImplementation(() => {
        const idx = callIndex++;
        if (idx === 1) {
          // Previous aggregate fails
          return Promise.reject(
            new GscApiError("SERVER_ERROR", "Google is temporarily unavailable.", 500),
          );
        }
        const responses = [currentAggregate, null, byQueryData, byPageData];
        return Promise.resolve(responses[idx]);
      });

      const client = mockClient({
        querySearchAnalytics: queryFn,
        listSitemaps: vi.fn().mockResolvedValue(sitemapsList),
      });

      const result = await weeklyReport(client, "sc-domain:sitefire.ai");

      // Previous agg failed, so partial_failures should include it
      expect(result.partial_failures).toHaveLength(1);
      expect(result.partial_failures[0]).toContain("previous aggregate");

      // Rollup should still work from current aggregate
      expect(result.rollup).not.toBeNull();
      expect(result.rollup!.clicks).toBe(1842);

      // wow_delta is null because previous aggregate failed
      expect(result.wow_delta).toBeNull();

      // Top queries and pages still intact
      expect(result.top_queries).toHaveLength(5);
      expect(result.top_pages).toHaveLength(3);

      // Sitemap data still intact
      expect(result.sitemap_count).toBe(1);
    });

    it("captures sitemaps failure, search data intact", async () => {
      let callIndex = 0;
      const queryFn = vi.fn().mockImplementation(() => {
        const responses = [currentAggregate, previousAggregate, byQueryData, byPageData];
        return Promise.resolve(responses[callIndex++]);
      });

      const client = mockClient({
        querySearchAnalytics: queryFn,
        listSitemaps: vi.fn().mockRejectedValue(
          new GscApiError("SERVER_ERROR", "Google is temporarily unavailable.", 500),
        ),
      });

      const result = await weeklyReport(client, "sc-domain:sitefire.ai");

      expect(result.partial_failures).toHaveLength(1);
      expect(result.partial_failures[0]).toContain("sitemaps.list");
      expect(result.rollup).not.toBeNull();
      expect(result.sitemap_count).toBe(0);
    });
  });

  describe("empty state (new property)", () => {
    it("sets is_new_property and guidance when all data is empty", async () => {
      const emptyResult: SearchAnalyticsResult = { rows: [] };
      const client = mockClient({
        querySearchAnalytics: vi.fn().mockResolvedValue(emptyResult),
        listSitemaps: vi.fn().mockResolvedValue([]),
      });

      const result = await weeklyReport(client, "sc-domain:new-site.com");

      expect(result.is_new_property).toBe(true);
      expect(result.empty_state_guidance).toContain("too fresh");
      expect(result.empty_state_guidance).toContain("setup_check");
      expect(result.rollup).toBeNull();
      expect(result.wow_delta).toBeNull();
      expect(result.top_queries).toEqual([]);
      expect(result.top_pages).toEqual([]);
      expect(result.partial_failures).toEqual([]);
    });
  });

  describe("invalid site", () => {
    it("throws GscApiError when all 5 calls fail (invalid property)", async () => {
      const notFoundError = new GscApiError(
        "NOT_FOUND",
        "No such property in this Google account. Run list_my_properties.",
        404,
      );

      const client = mockClient({
        querySearchAnalytics: vi.fn().mockRejectedValue(notFoundError),
        listSitemaps: vi.fn().mockRejectedValue(notFoundError),
      });

      await expect(
        weeklyReport(client, "sc-domain:nonexistent.com"),
      ).rejects.toThrow(GscApiError);
    });
  });

  describe("wow_delta edge cases", () => {
    it("wow_delta is null when previous period has zero data", async () => {
      const emptyResult: SearchAnalyticsResult = { rows: [] };
      let callIndex = 0;
      const queryFn = vi.fn().mockImplementation(() => {
        const idx = callIndex++;
        if (idx === 1) return Promise.resolve(emptyResult); // previous agg: empty
        const responses = [currentAggregate, null, byQueryData, byPageData];
        return Promise.resolve(responses[idx]);
      });

      const client = mockClient({
        querySearchAnalytics: queryFn,
        listSitemaps: vi.fn().mockResolvedValue(sitemapsList),
      });

      const result = await weeklyReport(client, "sc-domain:sitefire.ai");

      expect(result.wow_delta).toBeNull();
      expect(result.rollup).not.toBeNull();
    });

    it("wow_delta handles previous period with zero clicks and impressions", async () => {
      const zeroPrevious: SearchAnalyticsResult = {
        rows: [{ keys: [], clicks: 0, impressions: 0, ctr: 0, position: 0 }],
      };
      let callIndex = 0;
      const queryFn = vi.fn().mockImplementation(() => {
        const idx = callIndex++;
        if (idx === 1) return Promise.resolve(zeroPrevious);
        const responses = [currentAggregate, null, byQueryData, byPageData];
        return Promise.resolve(responses[idx]);
      });

      const client = mockClient({
        querySearchAnalytics: queryFn,
        listSitemaps: vi.fn().mockResolvedValue(sitemapsList),
      });

      const result = await weeklyReport(client, "sc-domain:sitefire.ai");

      expect(result.wow_delta).toBeNull();
    });
  });

  describe("sitemap health", () => {
    it("aggregates errors and warnings across multiple sitemaps", async () => {
      const multipleSitemaps: SitemapEntry[] = [
        {
          path: "https://example.com/sitemap-1.xml",
          lastDownloaded: "2026-04-10T10:00:00.000Z",
          errors: "2",
          warnings: "1",
        },
        {
          path: "https://example.com/sitemap-2.xml",
          lastDownloaded: "2026-04-12T15:00:00.000Z",
          errors: "0",
          warnings: "3",
        },
      ];

      let callIndex = 0;
      const queryFn = vi.fn().mockImplementation(() => {
        const responses = [currentAggregate, previousAggregate, byQueryData, byPageData];
        return Promise.resolve(responses[callIndex++]);
      });

      const client = mockClient({
        querySearchAnalytics: queryFn,
        listSitemaps: vi.fn().mockResolvedValue(multipleSitemaps),
      });

      const result = await weeklyReport(client, "sc-domain:sitefire.ai");

      expect(result.sitemap_count).toBe(2);
      expect(result.sitemap_health.errors).toBe(2);
      expect(result.sitemap_health.warnings).toBe(4);
      expect(result.sitemap_health.last_downloaded).toBe("2026-04-12T15:00:00.000Z");
    });

    it("last_downloaded is null when no sitemaps have been downloaded", async () => {
      const noDownloadSitemaps: SitemapEntry[] = [
        { path: "https://example.com/sitemap.xml", errors: "0", warnings: "0" },
      ];

      let callIndex = 0;
      const queryFn = vi.fn().mockImplementation(() => {
        const responses = [currentAggregate, previousAggregate, byQueryData, byPageData];
        return Promise.resolve(responses[callIndex++]);
      });

      const client = mockClient({
        querySearchAnalytics: queryFn,
        listSitemaps: vi.fn().mockResolvedValue(noDownloadSitemaps),
      });

      const result = await weeklyReport(client, "sc-domain:sitefire.ai");

      expect(result.sitemap_health.last_downloaded).toBeNull();
    });
  });
});
