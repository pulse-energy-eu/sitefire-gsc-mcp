/**
 * list_my_properties tool.
 *
 * Answers: "Which sites are under my Google account?"
 * Calls webmasters.sites.list() and returns a structured property list.
 */
import type { GscClient } from "../gsc-client.js";
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
export declare function listMyProperties(client: GscClient): Promise<PropertyList>;
//# sourceMappingURL=list-my-properties.d.ts.map