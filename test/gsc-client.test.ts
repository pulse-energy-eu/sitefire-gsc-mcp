import { describe, it, expect, vi, beforeEach } from "vitest";
import { GscClient } from "../src/gsc-client.js";
import { GscApiError, ReauthRequired } from "../src/gsc-errors.js";

import sitesListFixture from "./fixtures/live/sites-list.json";
import byQueryFixture from "./fixtures/live/searchanalytics-by-query.json";
import byPageFixture from "./fixtures/live/searchanalytics-by-page.json";
import sitemapsFixture from "./fixtures/live/sitemaps-list.json";
import inspectionFixture from "./fixtures/live/urlinspection-indexed.json";
import emptyProperties from "./fixtures/synthetic/empty-properties.json";

// Mock googleapis
vi.mock("googleapis", () => {
  const mockWebmasters = {
    sites: { list: vi.fn() },
    searchanalytics: { query: vi.fn() },
    sitemaps: { list: vi.fn() },
  };
  const mockSearchconsole = {
    urlInspection: { index: { inspect: vi.fn() } },
  };
  return {
    google: {
      webmasters: () => mockWebmasters,
      searchconsole: () => mockSearchconsole,
    },
    __mockWebmasters: mockWebmasters,
    __mockSearchconsole: mockSearchconsole,
  };
});

// Mock auth.ts to prevent side effects
vi.mock("../src/auth.js", () => ({
  deleteToken: vi.fn(),
}));

// Get mock handles
const { __mockWebmasters: mockWm, __mockSearchconsole: mockSc } = await import("googleapis") as any;

function createClient(): GscClient {
  return new GscClient({} as any);
}

describe("GscClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listSites", () => {
    it("returns typed site entries from fixture", async () => {
      mockWm.sites.list.mockResolvedValue({ data: sitesListFixture });
      const client = createClient();
      const sites = await client.listSites();

      expect(sites).toHaveLength(1);
      expect(sites[0]).toEqual({
        siteUrl: "sc-domain:sitefire.ai",
        permissionLevel: "siteFullUser",
      });
    });

    it("returns empty array when no properties", async () => {
      mockWm.sites.list.mockResolvedValue({ data: emptyProperties });
      const client = createClient();
      const sites = await client.listSites();

      expect(sites).toEqual([]);
    });

    it("throws ReauthRequired on 401", async () => {
      mockWm.sites.list.mockRejectedValue({
        code: 401,
        message: "Request had invalid authentication credentials.",
      });
      const client = createClient();

      await expect(client.listSites()).rejects.toThrow(ReauthRequired);
    });

    it("throws GscApiError on 403", async () => {
      mockWm.sites.list.mockRejectedValue({
        code: 403,
        message: "User does not have sufficient permission",
        errors: [{ reason: "forbidden" }],
      });
      const client = createClient();

      await expect(client.listSites()).rejects.toThrow(GscApiError);
    });
  });

  describe("querySearchAnalytics", () => {
    it("returns typed rows from by-query fixture", async () => {
      mockWm.searchanalytics.query.mockResolvedValue({ data: byQueryFixture });
      const client = createClient();
      const result = await client.querySearchAnalytics("sc-domain:sitefire.ai", {
        startDate: "2026-03-18",
        endDate: "2026-04-14",
        dimensions: ["query"],
        rowLimit: 5,
      });

      expect(result.rows).toHaveLength(5);
      expect(result.rows[0].keys).toEqual(["sitefire"]);
      expect(result.rows[0].clicks).toBe(292);
      expect(result.rows[0].impressions).toBe(1850);
      expect(result.rows[0].ctr).toBe(0.1578);
      expect(result.rows[0].position).toBe(1.3);
    });

    it("returns empty rows for new property", async () => {
      mockWm.searchanalytics.query.mockResolvedValue({
        data: { rows: [], responseAggregationType: "AUTO" },
      });
      const client = createClient();
      const result = await client.querySearchAnalytics("sc-domain:new-site.com", {
        startDate: "2026-03-18",
        endDate: "2026-04-14",
      });

      expect(result.rows).toEqual([]);
    });

    it("throws NOT_FOUND for invalid property", async () => {
      mockWm.searchanalytics.query.mockRejectedValue({
        code: 404,
        message: "User does not have access to the requested site.",
      });
      const client = createClient();

      await expect(
        client.querySearchAnalytics("sc-domain:nonexistent.com", {
          startDate: "2026-03-18",
          endDate: "2026-04-14",
        }),
      ).rejects.toThrow(GscApiError);
    });
  });

  describe("inspectUrl", () => {
    it("returns typed inspection result from fixture", async () => {
      mockSc.urlInspection.index.inspect.mockResolvedValue({ data: inspectionFixture });
      const client = createClient();
      const result = await client.inspectUrl("sc-domain:sitefire.ai", "https://sitefire.ai/");

      expect(result.inspectionResult.indexStatusResult.verdict).toBe("PASS");
      expect(result.inspectionResult.indexStatusResult.coverageState).toBe(
        "Submitted and indexed",
      );
      expect(result.inspectionResult.indexStatusResult.crawledAs).toBe("MOBILE");
      expect(result.inspectionResult.indexStatusResult.googleCanonical).toBe(
        "https://sitefire.ai/",
      );
    });

    it("throws RATE_LIMITED on 429", async () => {
      mockSc.urlInspection.index.inspect.mockRejectedValue({
        code: 429,
        message: "Quota exceeded for URL inspection requests",
      });
      const client = createClient();

      await expect(
        client.inspectUrl("sc-domain:sitefire.ai", "https://sitefire.ai/"),
      ).rejects.toThrow(GscApiError);
    });
  });

  describe("listSitemaps", () => {
    it("returns typed sitemap entries from fixture", async () => {
      mockWm.sitemaps.list.mockResolvedValue({ data: sitemapsFixture });
      const client = createClient();
      const sitemaps = await client.listSitemaps("sc-domain:sitefire.ai");

      expect(sitemaps).toHaveLength(1);
      expect(sitemaps[0].path).toBe("https://sitefire.ai/sitemap.xml");
      expect(sitemaps[0].errors).toBe("0");
      expect(sitemaps[0].contents?.[0].submitted).toBe("42");
    });

    it("returns empty array when no sitemaps", async () => {
      mockWm.sitemaps.list.mockResolvedValue({ data: {} });
      const client = createClient();
      const sitemaps = await client.listSitemaps("sc-domain:sitefire.ai");

      expect(sitemaps).toEqual([]);
    });
  });

  describe("retry on 5xx", () => {
    it("retries once on 5xx then succeeds", async () => {
      mockWm.sites.list
        .mockRejectedValueOnce({ code: 503, message: "Service Unavailable" })
        .mockResolvedValueOnce({ data: sitesListFixture });
      const client = createClient();
      const sites = await client.listSites();

      expect(sites).toHaveLength(1);
      expect(mockWm.sites.list).toHaveBeenCalledTimes(2);
    });

    it("throws after second 5xx failure", async () => {
      mockWm.sites.list.mockRejectedValue({
        code: 503,
        message: "Service Unavailable",
      });
      const client = createClient();

      await expect(client.listSites()).rejects.toThrow(GscApiError);
    });

    it("does NOT retry on 4xx", async () => {
      mockWm.sites.list.mockRejectedValue({
        code: 404,
        message: "Not Found",
      });
      const client = createClient();

      await expect(client.listSites()).rejects.toThrow(GscApiError);
      expect(mockWm.sites.list).toHaveBeenCalledTimes(1);
    });
  });
});
