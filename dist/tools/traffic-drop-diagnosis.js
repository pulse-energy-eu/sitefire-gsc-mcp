/**
 * traffic_drop_diagnosis tool (composite).
 *
 * Answers: "Why did my Google traffic drop? Is it one query, many
 * queries, a specific page, or everything?"
 *
 * Makes 4 parallel searchAnalytics.query calls via Promise.allSettled
 * (current/previous x query/page dimensions), then attributes the root
 * cause of any traffic decline.
 */
import { gscComparisonRanges } from "./shared/gsc-dates.js";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const GSC_NOTE = "Google Search Console data has a 2-3 day freshness lag and is sampled. " +
    "Small fluctuations may be noise rather than a real trend.";
function pctChange(current, previous) {
    if (previous === 0)
        return current === 0 ? 0 : 1;
    return (current - previous) / previous;
}
function toQueryMap(rows) {
    const map = new Map();
    for (const r of rows) {
        map.set(r.keys[0] ?? "", r);
    }
    return map;
}
function computeQueryLosses(currentRows, previousRows) {
    const prevMap = toQueryMap(previousRows);
    const currentMap = toQueryMap(currentRows);
    // Gather all query keys from both periods
    const allKeys = new Set([...prevMap.keys(), ...currentMap.keys()]);
    const losses = [];
    for (const key of allKeys) {
        const curr = currentMap.get(key);
        const prev = prevMap.get(key);
        const currClicks = curr?.clicks ?? 0;
        const prevClicks = prev?.clicks ?? 0;
        const clickDelta = currClicks - prevClicks;
        if (clickDelta >= 0)
            continue; // not a loss
        losses.push({
            query: key,
            clicks: currClicks,
            impressions: curr?.impressions ?? 0,
            ctr: curr?.ctr ?? 0,
            position: curr?.position ?? 0,
            delta: {
                clicks: pctChange(currClicks, prevClicks),
                impressions: pctChange(curr?.impressions ?? 0, prev?.impressions ?? 0),
                position: (curr?.position ?? 0) - (prev?.position ?? 0),
            },
        });
    }
    // Sort by delta.clicks ascending (most negative = biggest loss = first)
    losses.sort((a, b) => a.delta.clicks - b.delta.clicks);
    return losses.slice(0, 10);
}
function computePageLosses(currentRows, previousRows) {
    const prevMap = toQueryMap(previousRows); // same key structure works for pages
    const currentMap = toQueryMap(currentRows);
    const allKeys = new Set([...prevMap.keys(), ...currentMap.keys()]);
    const losses = [];
    for (const key of allKeys) {
        const curr = currentMap.get(key);
        const prev = prevMap.get(key);
        const currClicks = curr?.clicks ?? 0;
        const prevClicks = prev?.clicks ?? 0;
        const clickDelta = currClicks - prevClicks;
        if (clickDelta >= 0)
            continue;
        losses.push({
            page: key,
            clicks: currClicks,
            impressions: curr?.impressions ?? 0,
            ctr: curr?.ctr ?? 0,
            position: curr?.position ?? 0,
            delta: {
                clicks: pctChange(currClicks, prevClicks),
                impressions: pctChange(curr?.impressions ?? 0, prev?.impressions ?? 0),
                position: (curr?.position ?? 0) - (prev?.position ?? 0),
            },
        });
    }
    losses.sort((a, b) => a.delta.clicks - b.delta.clicks);
    return losses.slice(0, 10);
}
function computeOverallChange(currentRows, previousRows) {
    const sumClicks = (rows) => rows.reduce((s, r) => s + r.clicks, 0);
    const sumImpressions = (rows) => rows.reduce((s, r) => s + r.impressions, 0);
    const avgPosition = (rows) => {
        if (rows.length === 0)
            return 0;
        // Weighted by impressions for a more meaningful average
        const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0);
        if (totalImpressions === 0)
            return 0;
        return rows.reduce((s, r) => s + r.position * r.impressions, 0) / totalImpressions;
    };
    const currClicks = sumClicks(currentRows);
    const prevClicks = sumClicks(previousRows);
    const currImpressions = sumImpressions(currentRows);
    const prevImpressions = sumImpressions(previousRows);
    const currPos = avgPosition(currentRows);
    const prevPos = avgPosition(previousRows);
    return {
        clicks: pctChange(currClicks, prevClicks),
        impressions: pctChange(currImpressions, prevImpressions),
        position: currPos - prevPos, // positive = worsened (higher number = lower rank)
    };
}
function attributeRootCause(overallChange, queryLosses, currentQueryRows, previousQueryRows) {
    // 0. New property with no data at all
    if (currentQueryRows.length === 0 && previousQueryRows.length === 0) {
        return {
            primary: "none",
            confidence: "high",
            explanation: "No search data available for either period. This property may " +
                "be too new for Google to have collected data. Run setup_check " +
                "for a status summary, or check back in a few days.",
        };
    }
    // 1. No drop at all
    if (overallChange.clicks >= 0) {
        return {
            primary: "none",
            confidence: "high",
            explanation: "No traffic drop detected in the comparison period. " +
                "Clicks are flat or growing.",
        };
    }
    // Total click loss (absolute)
    const prevTotalClicks = previousQueryRows.reduce((s, r) => s + r.clicks, 0);
    const currTotalClicks = currentQueryRows.reduce((s, r) => s + r.clicks, 0);
    const totalClickLoss = prevTotalClicks - currTotalClicks;
    // 2. Query loss: top 3 queries account for >60% of total click loss
    if (totalClickLoss > 0 && queryLosses.length > 0) {
        const prevMap = toQueryMap(previousQueryRows);
        const currMap = toQueryMap(currentQueryRows);
        const top3AbsLoss = queryLosses.slice(0, 3).reduce((s, q) => {
            const prev = prevMap.get(q.query)?.clicks ?? 0;
            const curr = currMap.get(q.query)?.clicks ?? 0;
            return s + (prev - curr);
        }, 0);
        if (top3AbsLoss / totalClickLoss > 0.6) {
            const topQueries = queryLosses
                .slice(0, 3)
                .map((q) => `"${q.query}"`)
                .join(", ");
            return {
                primary: "query_loss",
                confidence: "high",
                explanation: `A small number of queries (${topQueries}) account for most of ` +
                    `the click loss. Investigate whether these queries lost ranking ` +
                    `or if search demand changed.`,
            };
        }
    }
    // 3. Rank drop: average position worsened by >2 across many queries
    if (overallChange.position > 2) {
        return {
            primary: "rank_drop",
            confidence: "medium",
            explanation: `Average position worsened by ${overallChange.position.toFixed(1)} ` +
                `positions. This suggests a broad ranking regression, possibly from ` +
                `an algorithm update or technical issue (slow pages, crawl errors).`,
        };
    }
    // 4. Coverage loss: impressions dropped >30% but position stayed similar
    if (overallChange.impressions < -0.3 &&
        Math.abs(overallChange.position) <= 2) {
        return {
            primary: "coverage_loss",
            confidence: "medium",
            explanation: "Impressions dropped significantly while rankings stayed similar. " +
                "Pages may have been deindexed or removed from the sitemap. " +
                "Run inspect_url on your top pages to check index status.",
        };
    }
    // 5. Seasonal: clicks and impressions both dropped proportionally
    const clickDrop = Math.abs(overallChange.clicks);
    const impressionDrop = Math.abs(overallChange.impressions);
    if (impressionDrop > 0.05 &&
        clickDrop > 0.05 &&
        Math.abs(clickDrop - impressionDrop) / Math.max(clickDrop, impressionDrop) < 0.3) {
        return {
            primary: "seasonal",
            confidence: "low",
            explanation: "Clicks and impressions dropped at roughly the same rate, which " +
                "suggests reduced search demand rather than a ranking change. " +
                "This could be seasonal or a shift in user behavior.",
        };
    }
    // 6. Fallback
    return {
        primary: "query_loss",
        confidence: "low",
        explanation: "Traffic declined but no single root cause stands out clearly. " +
            "Review the top_query_losses and top_page_losses for patterns.",
    };
}
// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export async function trafficDropDiagnosis(client, siteUrl, comparePeriod = "wow") {
    // Both "wow" and "mom" use the same adjacent-28-day math
    void comparePeriod; // kept for the user's mental model
    const ranges = gscComparisonRanges(28);
    // 4 parallel calls via Promise.allSettled
    const [currentQueryResult, previousQueryResult, currentPageResult, previousPageResult,] = await Promise.allSettled([
        client.querySearchAnalytics(siteUrl, {
            startDate: ranges.current.start,
            endDate: ranges.current.end,
            dimensions: ["query"],
            rowLimit: 1000,
        }),
        client.querySearchAnalytics(siteUrl, {
            startDate: ranges.previous.start,
            endDate: ranges.previous.end,
            dimensions: ["query"],
            rowLimit: 1000,
        }),
        client.querySearchAnalytics(siteUrl, {
            startDate: ranges.current.start,
            endDate: ranges.current.end,
            dimensions: ["page"],
            rowLimit: 1000,
        }),
        client.querySearchAnalytics(siteUrl, {
            startDate: ranges.previous.start,
            endDate: ranges.previous.end,
            dimensions: ["page"],
            rowLimit: 1000,
        }),
    ]);
    // If ALL 4 failed with the same error, throw it
    const results = [
        currentQueryResult,
        previousQueryResult,
        currentPageResult,
        previousPageResult,
    ];
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length === results.length) {
        // All failed - throw the first error
        throw failures[0].reason;
    }
    // Collect partial failures
    const partialFailures = [];
    const labels = [
        "current queries",
        "previous queries",
        "current pages",
        "previous pages",
    ];
    for (let i = 0; i < results.length; i++) {
        if (results[i].status === "rejected") {
            const err = results[i].reason;
            const msg = err instanceof Error ? err.message : String(err);
            partialFailures.push(`${labels[i]}: ${msg}`);
        }
    }
    // Extract rows from successful results (empty array for failures)
    const extractRows = (r) => r.status === "fulfilled" ? r.value.rows : [];
    const currentQueryRows = extractRows(currentQueryResult);
    const previousQueryRows = extractRows(previousQueryResult);
    const currentPageRows = extractRows(currentPageResult);
    const previousPageRows = extractRows(previousPageResult);
    // Compute deltas
    const overallChange = computeOverallChange(currentQueryRows, previousQueryRows);
    const queryLosses = computeQueryLosses(currentQueryRows, previousQueryRows);
    const pageLosses = computePageLosses(currentPageRows, previousPageRows);
    // Attribute root cause
    const rootCause = attributeRootCause(overallChange, queryLosses, currentQueryRows, previousQueryRows);
    const diagnosis = {
        site_url: siteUrl,
        compare: {
            current_period: ranges.current,
            previous_period: ranges.previous,
        },
        overall_change: overallChange,
        root_cause_attribution: rootCause,
        top_query_losses: queryLosses,
        top_page_losses: pageLosses,
        note: GSC_NOTE,
    };
    if (partialFailures.length > 0) {
        diagnosis.partial_failures = partialFailures;
    }
    return diagnosis;
}
//# sourceMappingURL=traffic-drop-diagnosis.js.map