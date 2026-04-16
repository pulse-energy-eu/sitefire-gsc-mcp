/**
 * detect_cannibalization tool.
 *
 * Answers: "Are multiple pages on my site competing for the same Google query?"
 *
 * Fetches query+page dimension data, groups by query, and identifies
 * queries where 2+ pages compete. Recommends consolidating into the
 * page with the most clicks.
 */
import { gscDateRange } from "./shared/gsc-dates.js";
const ANONYMIZATION_NOTE = "GSC anonymizes queries with low search volumes; cannibalization on long-tail terms may be invisible.";
/**
 * Detect keyword cannibalization for a site.
 *
 * @param client - authenticated GscClient
 * @param siteUrl - the GSC property identifier
 * @param minImpressions - minimum total impressions to consider a query cannibalized (default 50)
 */
export async function detectCannibalization(client, siteUrl, minImpressions = 50) {
    const period = gscDateRange(28);
    // Fetch query+page rows. Errors propagate naturally (no useless try/catch).
    const result = await client.querySearchAnalytics(siteUrl, {
        startDate: period.start,
        endDate: period.end,
        dimensions: ["query", "page"],
        rowLimit: 1000,
    });
    const rows = result.rows;
    // Group rows by query
    const byQuery = new Map();
    for (const row of rows) {
        const query = row.keys[0] ?? "";
        const existing = byQuery.get(query);
        if (existing) {
            existing.push(row);
        }
        else {
            byQuery.set(query, [row]);
        }
    }
    // Identify cannibalized queries: 2+ pages AND total impressions >= threshold
    const cannibalized = [];
    for (const [query, queryRows] of byQuery) {
        if (queryRows.length < 2)
            continue;
        const totalImpressions = queryRows.reduce((sum, r) => sum + r.impressions, 0);
        if (totalImpressions < minImpressions)
            continue;
        // Sort pages by clicks descending to find the winner
        const sorted = [...queryRows].sort((a, b) => b.clicks - a.clicks);
        const winnerUrl = sorted[0].keys[1] ?? sorted[0].keys[0];
        const competingPages = sorted.map((r) => ({
            page: r.keys[1] ?? "",
            clicks: r.clicks,
            impressions: r.impressions,
            position: r.position,
        }));
        cannibalized.push({
            query,
            competing_pages: competingPages,
            total_impressions: totalImpressions,
            recommended_action: `Consolidate into the page at ${winnerUrl}, redirect others`,
        });
    }
    // Sort by total impressions descending
    cannibalized.sort((a, b) => b.total_impressions - a.total_impressions);
    return {
        period,
        site_url: siteUrl,
        threshold: minImpressions,
        cannibalized_queries: cannibalized,
        note: ANONYMIZATION_NOTE,
    };
}
//# sourceMappingURL=detect-cannibalization.js.map