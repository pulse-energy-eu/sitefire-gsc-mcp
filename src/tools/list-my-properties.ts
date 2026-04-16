/**
 * list_my_properties tool.
 *
 * Answers: "Which sites are under my Google account?"
 * Calls webmasters.sites.list() and returns a structured property list.
 */

import type { GscClient, SiteEntry } from "../gsc-client.js";

export interface PropertyItem {
  site_url: string;
  permission_level: string;
  type: "domain" | "url_prefix";
}

export interface PropertyList {
  properties: PropertyItem[];
  count: number;
  next_step: string | null;
}

function classifyPropertyType(siteUrl: string): "domain" | "url_prefix" {
  return siteUrl.startsWith("sc-domain:") ? "domain" : "url_prefix";
}

function mapSiteEntry(entry: SiteEntry): PropertyItem {
  return {
    site_url: entry.siteUrl,
    permission_level: entry.permissionLevel,
    type: classifyPropertyType(entry.siteUrl),
  };
}

export async function listMyProperties(
  client: GscClient,
): Promise<PropertyList> {
  const sites = await client.listSites();
  const properties = sites.map(mapSiteEntry);

  return {
    properties,
    count: properties.length,
    next_step:
      properties.length === 0
        ? "No properties in this Google account. Run setup_check for a step-by-step guide to adding your first one."
        : null,
  };
}
