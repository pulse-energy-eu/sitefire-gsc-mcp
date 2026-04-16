/**
 * list_my_properties tool.
 *
 * Answers: "Which sites are under my Google account?"
 * Calls webmasters.sites.list() and returns a structured property list.
 */
function classifyPropertyType(siteUrl) {
    return siteUrl.startsWith("sc-domain:") ? "domain" : "url_prefix";
}
function mapSiteEntry(entry) {
    return {
        site_url: entry.siteUrl,
        permission_level: entry.permissionLevel,
        type: classifyPropertyType(entry.siteUrl),
    };
}
export async function listMyProperties(client) {
    const sites = await client.listSites();
    const properties = sites.map(mapSiteEntry);
    return {
        properties,
        count: properties.length,
        next_step: properties.length === 0
            ? "No properties in this Google account. Run setup_check for a step-by-step guide to adding your first one."
            : null,
    };
}
//# sourceMappingURL=list-my-properties.js.map