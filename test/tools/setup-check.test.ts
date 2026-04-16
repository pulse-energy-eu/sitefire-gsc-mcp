import { describe, it, expect, vi } from "vitest";
import { setupCheck } from "../../src/tools/setup-check.js";
import { GscApiError } from "../../src/gsc-errors.js";
import { mockClient } from "../helpers/mock-client.js";
import type { AuthState } from "../../src/auth.js";

const validAuth: AuthState = { status: "valid", message: "Google authorization is valid." };
const invalidAuth: AuthState = {
  status: "invalid",
  message: "Your Google authorization was revoked or expired. Run setup_check to re-authenticate.",
};

describe("setupCheck", () => {
  it("all green with sitefire fixture", async () => {
    const client = mockClient({
      listSites: vi.fn().mockResolvedValue([
        { siteUrl: "sc-domain:sitefire.ai", permissionLevel: "siteFullUser" },
      ]),
      listSitemaps: vi.fn().mockResolvedValue([
        { path: "https://sitefire.ai/sitemap.xml", errors: "0", warnings: "0" },
      ]),
      querySearchAnalytics: vi.fn().mockResolvedValue({
        rows: [{ keys: [], clicks: 1842, impressions: 28450, ctr: 0.0647, position: 12.3 }],
      }),
    });

    const result = await setupCheck(client, validAuth, "sc-domain:sitefire.ai");

    expect(result.auth_valid).toBe(true);
    expect(result.properties_count).toBe(1);
    expect(result.target_site).toBe("sc-domain:sitefire.ai");
    expect(result.checks.property_accessible).toBe("pass");
    expect(result.checks.sitemap_submitted).toBe("pass");
    expect(result.checks.data_available).toBe("pass");
    expect(result.checks.has_clicks_in_28d).toBe("pass");
    expect(result.next_actions[0]).toContain("Everything looks good");
  });

  it("returns auth failure when token is invalid", async () => {
    const client = mockClient();
    const result = await setupCheck(client, invalidAuth);

    expect(result.auth_valid).toBe(false);
    expect(result.properties_count).toBe(0);
    expect(result.next_actions[0]).toContain("OAuth flow");
  });

  it("returns property-creation pointer when zero properties", async () => {
    const client = mockClient({
      listSites: vi.fn().mockResolvedValue([]),
    });

    const result = await setupCheck(client, validAuth);

    expect(result.auth_valid).toBe(true);
    expect(result.properties_count).toBe(0);
    expect(result.next_actions).toContain(
      "Add a property at search.google.com/search-console.",
    );
    expect(result.next_actions).toContain(
      "Verify domain ownership via DNS TXT or HTML file upload.",
    );
  });

  it("shows submit-sitemap action when no sitemap", async () => {
    const client = mockClient({
      listSites: vi.fn().mockResolvedValue([
        { siteUrl: "sc-domain:sitefire.ai", permissionLevel: "siteFullUser" },
      ]),
      listSitemaps: vi.fn().mockResolvedValue([]),
      querySearchAnalytics: vi.fn().mockResolvedValue({
        rows: [{ keys: [], clicks: 100, impressions: 500, ctr: 0.2, position: 5 }],
      }),
    });

    const result = await setupCheck(client, validAuth, "sc-domain:sitefire.ai");

    expect(result.checks.sitemap_submitted).toBe("fail");
    expect(result.next_actions.some((a) => a.includes("Submit a sitemap"))).toBe(true);
  });

  it("shows pending data_available for new property", async () => {
    const client = mockClient({
      listSites: vi.fn().mockResolvedValue([
        { siteUrl: "sc-domain:new-site.com", permissionLevel: "siteOwner" },
      ]),
      listSitemaps: vi.fn().mockResolvedValue([
        { path: "https://new-site.com/sitemap.xml" },
      ]),
      querySearchAnalytics: vi.fn().mockResolvedValue({ rows: [] }),
    });

    const result = await setupCheck(client, validAuth, "sc-domain:new-site.com");

    expect(result.checks.data_available).toBe("pending");
    expect(result.checks.has_clicks_in_28d).toBe("n/a");
    expect(result.next_actions.some((a) => a.includes("2-7 days"))).toBe(true);
  });

  it("infers target_site when site_url omitted and single-property account", async () => {
    const client = mockClient({
      listSites: vi.fn().mockResolvedValue([
        { siteUrl: "sc-domain:sitefire.ai", permissionLevel: "siteFullUser" },
      ]),
      listSitemaps: vi.fn().mockResolvedValue([
        { path: "https://sitefire.ai/sitemap.xml" },
      ]),
      querySearchAnalytics: vi.fn().mockResolvedValue({
        rows: [{ keys: [], clicks: 50, impressions: 200, ctr: 0.25, position: 3 }],
      }),
    });

    const result = await setupCheck(client, validAuth);

    expect(result.target_site).toBe("sc-domain:sitefire.ai");
    expect(result.checks.property_accessible).toBe("pass");
  });

  it("reports fail when target property is not in account", async () => {
    const client = mockClient({
      listSites: vi.fn().mockResolvedValue([
        { siteUrl: "sc-domain:sitefire.ai", permissionLevel: "siteFullUser" },
      ]),
    });

    const result = await setupCheck(client, validAuth, "sc-domain:other-site.com");

    expect(result.checks.property_accessible).toBe("fail");
    expect(result.next_actions.some((a) => a.includes("not accessible"))).toBe(true);
  });

  it("prompts to specify site_url when multiple properties and none specified", async () => {
    const client = mockClient({
      listSites: vi.fn().mockResolvedValue([
        { siteUrl: "sc-domain:sitefire.ai", permissionLevel: "siteFullUser" },
        { siteUrl: "https://example.com/", permissionLevel: "siteOwner" },
      ]),
    });

    const result = await setupCheck(client, validAuth);

    expect(result.target_site).toBeNull();
    expect(result.properties_count).toBe(2);
    expect(result.next_actions[0]).toContain("Specify a site_url");
  });

  it("shows has_clicks_in_28d fail when data exists but no clicks", async () => {
    const client = mockClient({
      listSites: vi.fn().mockResolvedValue([
        { siteUrl: "sc-domain:sitefire.ai", permissionLevel: "siteFullUser" },
      ]),
      listSitemaps: vi.fn().mockResolvedValue([
        { path: "https://sitefire.ai/sitemap.xml" },
      ]),
      querySearchAnalytics: vi.fn().mockResolvedValue({
        rows: [{ keys: [], clicks: 0, impressions: 100, ctr: 0, position: 20 }],
      }),
    });

    const result = await setupCheck(client, validAuth, "sc-domain:sitefire.ai");

    expect(result.checks.data_available).toBe("pass");
    expect(result.checks.has_clicks_in_28d).toBe("fail");
    expect(result.next_actions.some((a) => a.includes("no clicks"))).toBe(true);
  });
});
