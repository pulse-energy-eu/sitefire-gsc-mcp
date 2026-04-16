import { describe, it, expect, vi } from "vitest";
import { inspectUrlTool } from "../../src/tools/inspect-url.js";
import { GscApiError } from "../../src/gsc-errors.js";
import type { UrlInspectionResult } from "../../src/gsc-client.js";
import { mockClient } from "../helpers/mock-client.js";

import indexedFixture from "../fixtures/live/urlinspection-indexed.json";
import canonicalMismatchFixture from "../fixtures/live/urlinspection-canonical-mismatch.json";

describe("inspectUrlTool", () => {
  it("returns indexed state for PASS verdict", async () => {
    const client = mockClient({
      inspectUrl: vi.fn().mockResolvedValue(indexedFixture as UrlInspectionResult),
    });

    const result = await inspectUrlTool(
      client,
      "sc-domain:sitefire.ai",
      "https://sitefire.ai/",
    );

    expect(result.verdict).toBe("PASS");
    expect(result.coverage_state).toBe("Submitted and indexed");
    expect(result.interpretation.state).toBe("indexed");
    expect(result.interpretation.recommended_action).toBeNull();
    expect(result.robots_allowed).toBe(true);
    expect(result.indexing_allowed).toBe(true);
    expect(result.canonical_mismatch).toBe(false);
    expect(result.crawled_as).toBe("MOBILE");
    expect(result.mobile_usable).toBe(true);
    expect(result.referring_urls).toEqual(["https://www.ycombinator.com/companies/sitefire"]);
    expect(result.google_canonical).toBe("https://sitefire.ai/");
    expect(result.user_canonical).toBe("https://sitefire.ai/");
    expect(result.url).toBe("https://sitefire.ai/");
    expect(result.site_url).toBe("sc-domain:sitefire.ai");
    expect(result.last_crawl_time).toBe("2026-04-13T09:22:41.000Z");
    expect(result.crawl_age_days).toBeTypeOf("number");
  });

  it("detects canonical mismatch", async () => {
    const client = mockClient({
      inspectUrl: vi.fn().mockResolvedValue(canonicalMismatchFixture as UrlInspectionResult),
    });

    const result = await inspectUrlTool(
      client,
      "sc-domain:sitefire.ai",
      "https://sitefire.ai/blog/geo-optimization-guide",
    );

    expect(result.verdict).toBe("PARTIAL");
    expect(result.canonical_mismatch).toBe(true);
    expect(result.interpretation.state).toBe("canonical_mismatch");
    expect(result.interpretation.summary).toContain("different canonical");
    expect(result.interpretation.recommended_action).toBeTruthy();
    expect(result.google_canonical).toBe("https://sitefire.ai/blog/geo-guide");
    expect(result.user_canonical).toBe("https://sitefire.ai/blog/geo-optimization-guide");
  });

  it("detects crawled but not indexed", async () => {
    const crawledNotIndexed: UrlInspectionResult = {
      inspectionResult: {
        indexStatusResult: {
          verdict: "NEUTRAL",
          coverageState: "Crawled - currently not indexed",
          robotsTxtState: "ALLOWED",
          indexingState: "INDEXING_ALLOWED",
          lastCrawlTime: "2026-04-10T08:00:00.000Z",
          crawledAs: "MOBILE",
        },
      },
    };
    const client = mockClient({
      inspectUrl: vi.fn().mockResolvedValue(crawledNotIndexed),
    });

    const result = await inspectUrlTool(
      client,
      "sc-domain:sitefire.ai",
      "https://sitefire.ai/thin-page",
    );

    expect(result.interpretation.state).toBe("crawled_not_indexed");
    expect(result.interpretation.recommended_action).toContain("Improve the content");
  });

  it("detects robots-blocked URL", async () => {
    const robotsBlocked: UrlInspectionResult = {
      inspectionResult: {
        indexStatusResult: {
          verdict: "FAIL",
          coverageState: "Blocked by robots.txt",
          robotsTxtState: "DISALLOWED",
          indexingState: "INDEXING_ALLOWED",
          crawledAs: "MOBILE",
        },
      },
    };
    const client = mockClient({
      inspectUrl: vi.fn().mockResolvedValue(robotsBlocked),
    });

    const result = await inspectUrlTool(
      client,
      "sc-domain:sitefire.ai",
      "https://sitefire.ai/admin",
    );

    expect(result.robots_allowed).toBe(false);
    expect(result.interpretation.state).toBe("blocked");
    expect(result.interpretation.summary).toContain("robots.txt");
    expect(result.interpretation.recommended_action).toContain("robots.txt");
  });

  it("detects noindex-blocked URL", async () => {
    const noindexBlocked: UrlInspectionResult = {
      inspectionResult: {
        indexStatusResult: {
          verdict: "FAIL",
          coverageState: "Excluded by noindex tag",
          robotsTxtState: "ALLOWED",
          indexingState: "INDEXING_NOT_ALLOWED",
          crawledAs: "DESKTOP",
        },
      },
    };
    const client = mockClient({
      inspectUrl: vi.fn().mockResolvedValue(noindexBlocked),
    });

    const result = await inspectUrlTool(
      client,
      "sc-domain:sitefire.ai",
      "https://sitefire.ai/staging-page",
    );

    expect(result.indexing_allowed).toBe(false);
    expect(result.interpretation.state).toBe("blocked");
    expect(result.interpretation.summary).toContain("noindex");
    expect(result.crawled_as).toBe("DESKTOP");
  });

  it("throws on URL not under property", async () => {
    const client = mockClient({
      inspectUrl: vi.fn().mockRejectedValue(
        new GscApiError(
          "INVALID_ARGUMENT",
          "The property `sc-domain:sitefire.ai` isn't in the right format. Run list_my_properties to see the exact strings Google uses.",
          400,
        ),
      ),
    });

    await expect(
      inspectUrlTool(client, "sc-domain:sitefire.ai", "https://other-domain.com/page"),
    ).rejects.toThrow(GscApiError);
  });

  it("throws on rate limit", async () => {
    const client = mockClient({
      inspectUrl: vi.fn().mockRejectedValue(
        new GscApiError(
          "RATE_LIMITED",
          "Google's URL-inspection limit for this site has been hit. Try again in a minute or tomorrow.",
          429,
        ),
      ),
    });

    const err = await inspectUrlTool(
      client,
      "sc-domain:sitefire.ai",
      "https://sitefire.ai/",
    ).catch((e) => e);

    expect(err).toBeInstanceOf(GscApiError);
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.userMessage).toContain("limit");
  });

  it("handles null mobile usability", async () => {
    const noMobile: UrlInspectionResult = {
      inspectionResult: {
        indexStatusResult: {
          verdict: "PASS",
          coverageState: "Submitted and indexed",
          robotsTxtState: "ALLOWED",
          indexingState: "INDEXING_ALLOWED",
          crawledAs: "MOBILE",
        },
      },
    };
    const client = mockClient({
      inspectUrl: vi.fn().mockResolvedValue(noMobile),
    });

    const result = await inspectUrlTool(
      client,
      "sc-domain:sitefire.ai",
      "https://sitefire.ai/",
    );

    expect(result.mobile_usable).toBeNull();
  });

  it("limits referring_urls to 5", async () => {
    const manyRefs: UrlInspectionResult = {
      inspectionResult: {
        indexStatusResult: {
          verdict: "PASS",
          coverageState: "Submitted and indexed",
          robotsTxtState: "ALLOWED",
          indexingState: "INDEXING_ALLOWED",
          crawledAs: "MOBILE",
          referringUrls: [
            "https://a.com", "https://b.com", "https://c.com",
            "https://d.com", "https://e.com", "https://f.com",
            "https://g.com",
          ],
        },
      },
    };
    const client = mockClient({
      inspectUrl: vi.fn().mockResolvedValue(manyRefs),
    });

    const result = await inspectUrlTool(
      client,
      "sc-domain:sitefire.ai",
      "https://sitefire.ai/",
    );

    expect(result.referring_urls).toHaveLength(5);
  });
});
