/**
 * weekly_report tool (composite).
 *
 * Answers: "How is my site doing on Google this week?"
 * Fires five GSC calls in parallel via Promise.allSettled, aggregates
 * into a single report. Partial failures are captured in the
 * partial_failures array rather than failing the entire tool.
 */
import { GscApiError } from "../gsc-errors.js";
import { gscComparisonRanges } from "./shared/gsc-dates.js";
const EMPTY_STATE_GUIDANCE = "This property is too fresh to show search data. Google typically populates GSC within 2-7 days of first crawl. Run setup_check for a status summary, or come back in a few days.";
/**
 * Build the weekly report for a given site.
 * Errors from GscClient propagate naturally for invalid sites (NOT_FOUND, etc.).
 * For the five parallel calls, partial failures are captured rather than thrown.
 */
export async function weeklyReport(client, siteUrl, days = 28) {
    const { current, previous } = gscComparisonRanges(days);
    const [currentAggResult, previousAggResult, byQueryResult, byPageResult, sitemapsResult,] = await Promise.allSettled([
        client.querySearchAnalytics(siteUrl, {
            startDate: current.start,
            endDate: current.end,
        }),
        client.querySearchAnalytics(siteUrl, {
            startDate: previous.start,
            endDate: previous.end,
        }),
        client.querySearchAnalytics(siteUrl, {
            startDate: current.start,
            endDate: current.end,
            dimensions: ["query"],
            rowLimit: 10,
        }),
        client.querySearchAnalytics(siteUrl, {
            startDate: current.start,
            endDate: current.end,
            dimensions: ["page"],
            rowLimit: 10,
        }),
        client.listSitemaps(siteUrl),
    ]);
    const partialFailures = [];
    // Extract results, tracking partial failures
    const currentAgg = extractOrFail(currentAggResult, "searchAnalytics.query (current aggregate)", partialFailures);
    const previousAgg = extractOrFail(previousAggResult, "searchAnalytics.query (previous aggregate)", partialFailures);
    const byQuery = extractOrFail(byQueryResult, "searchAnalytics.query (by query)", partialFailures);
    const byPage = extractOrFail(byPageResult, "searchAnalytics.query (by page)", partialFailures);
    const sitemaps = extractOrFail(sitemapsResult, "sitemaps.list", partialFailures);
    // If every call failed, rethrow the first GscApiError so invalid-site
    // errors propagate through translateError rather than silently returning
    // an empty report.
    if (partialFailures.length === 5) {
        const allResults = [currentAggResult, previousAggResult, byQueryResult, byPageResult, sitemapsResult];
        const firstApiError = allResults
            .filter((r) => r.status === "rejected")
            .map((r) => r.reason)
            .find((e) => e instanceof GscApiError);
        if (firstApiError)
            throw firstApiError;
    }
    // Build rollup from current aggregate
    const rollup = buildRollup(currentAgg, byQuery, byPage);
    // Build wow_delta from current vs previous
    const wowDelta = buildWowDelta(currentAgg, previousAgg);
    // Build top queries and pages
    const topQueries = buildTopQueries(byQuery);
    const topPages = buildTopPages(byPage);
    // Build sitemap health
    const sitemapList = sitemaps ?? [];
    const sitemapHealth = buildSitemapHealth(sitemapList);
    // Determine empty state
    const isNewProperty = rollup === null &&
        topQueries.length === 0 &&
        topPages.length === 0;
    return {
        period: { start: current.start, end: current.end },
        site_url: siteUrl,
        is_new_property: isNewProperty,
        rollup,
        wow_delta: wowDelta,
        top_queries: topQueries,
        top_pages: topPages,
        sitemap_count: sitemapList.length,
        sitemap_health: sitemapHealth,
        partial_failures: partialFailures,
        empty_state_guidance: isNewProperty ? EMPTY_STATE_GUIDANCE : null,
    };
}
function extractOrFail(result, label, failures) {
    if (result.status === "fulfilled")
        return result.value;
    failures.push(label);
    return null;
}
function buildRollup(currentAgg, byQuery, byPage) {
    if (!currentAgg || currentAgg.rows.length === 0)
        return null;
    const row = currentAgg.rows[0];
    return {
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        avg_position: row.position,
        queries_count: byQuery?.rows.length ?? 0,
        pages_count: byPage?.rows.length ?? 0,
    };
}
function buildWowDelta(currentAgg, previousAgg) {
    if (!currentAgg || currentAgg.rows.length === 0)
        return null;
    if (!previousAgg || previousAgg.rows.length === 0)
        return null;
    const curr = currentAgg.rows[0];
    const prev = previousAgg.rows[0];
    // Avoid division by zero
    if (prev.clicks === 0 && prev.impressions === 0)
        return null;
    return {
        clicks: prev.clicks > 0 ? (curr.clicks - prev.clicks) / prev.clicks : 0,
        impressions: prev.impressions > 0 ? (curr.impressions - prev.impressions) / prev.impressions : 0,
        ctr: curr.ctr - prev.ctr,
        avg_position: curr.position - prev.position,
    };
}
function buildTopQueries(byQuery) {
    if (!byQuery)
        return [];
    return byQuery.rows.map((r) => ({
        query: r.keys[0] ?? "",
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        position: r.position,
    }));
}
function buildTopPages(byPage) {
    if (!byPage)
        return [];
    return byPage.rows.map((r) => ({
        page: r.keys[0] ?? "",
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        position: r.position,
    }));
}
function buildSitemapHealth(sitemaps) {
    let errors = 0;
    let warnings = 0;
    let lastDownloaded = null;
    for (const s of sitemaps) {
        errors += parseInt(s.errors ?? "0", 10) || 0;
        warnings += parseInt(s.warnings ?? "0", 10) || 0;
        if (s.lastDownloaded) {
            if (!lastDownloaded || s.lastDownloaded > lastDownloaded) {
                lastDownloaded = s.lastDownloaded;
            }
        }
    }
    return { errors, warnings, last_downloaded: lastDownloaded };
}
//# sourceMappingURL=weekly-report.js.map