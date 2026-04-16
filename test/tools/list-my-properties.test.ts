import { describe, it, expect, vi } from "vitest";
import { listMyProperties } from "../../src/tools/list-my-properties.js";
import { GscApiError, ReauthRequired } from "../../src/gsc-errors.js";
import { mockClient } from "../helpers/mock-client.js";

import sitesListFixture from "../fixtures/live/sites-list.json";

describe("listMyProperties", () => {
  it("returns structured list with 1+ properties (sitefire fixture)", async () => {
    const client = mockClient({
      listSites: vi.fn().mockResolvedValue(
        sitesListFixture.siteEntry.map((e) => ({
          siteUrl: e.siteUrl,
          permissionLevel: e.permissionLevel,
        })),
      ),
    });

    const result = await listMyProperties(client);

    expect(result.count).toBe(1);
    expect(result.next_step).toBeNull();
    expect(result.properties[0]).toEqual({
      site_url: "sc-domain:sitefire.ai",
      permission_level: "siteFullUser",
      type: "domain",
    });
  });

  it("classifies url_prefix properties correctly", async () => {
    const client = mockClient({
      listSites: vi.fn().mockResolvedValue([
        { siteUrl: "https://example.com/", permissionLevel: "siteOwner" },
        { siteUrl: "sc-domain:example.com", permissionLevel: "siteFullUser" },
      ]),
    });

    const result = await listMyProperties(client);

    expect(result.count).toBe(2);
    expect(result.properties[0].type).toBe("url_prefix");
    expect(result.properties[1].type).toBe("domain");
  });

  it("returns empty properties with setup_check pointer", async () => {
    const client = mockClient({
      listSites: vi.fn().mockResolvedValue([]),
    });

    const result = await listMyProperties(client);

    expect(result.count).toBe(0);
    expect(result.properties).toEqual([]);
    expect(result.next_step).toBe(
      "No properties in this Google account. Run setup_check for a step-by-step guide to adding your first one.",
    );
  });

  it("throws on revoked token", async () => {
    const client = mockClient({
      listSites: vi.fn().mockRejectedValue(
        new ReauthRequired("Token has been expired or revoked"),
      ),
    });

    await expect(listMyProperties(client)).rejects.toThrow(ReauthRequired);
  });

  it("throws GscApiError on API errors", async () => {
    const client = mockClient({
      listSites: vi.fn().mockRejectedValue(
        new GscApiError("UNKNOWN", "Unexpected error: something broke", 500),
      ),
    });

    await expect(listMyProperties(client)).rejects.toThrow(GscApiError);
  });
});
