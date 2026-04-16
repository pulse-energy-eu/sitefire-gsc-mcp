/**
 * setup_check tool.
 *
 * Answers: "Is everything configured correctly?" / "Where do I get started?"
 * Runs a checklist: auth valid, properties accessible, sitemap submitted,
 * data available, has clicks.
 */
import type { GscClient } from "../gsc-client.js";
import { type AuthState } from "../auth.js";
export interface SetupReport {
    auth_valid: boolean;
    properties_count: number;
    properties: string[];
    target_site: string | null;
    checks: {
        property_accessible: "pass" | "fail" | "n/a";
        sitemap_submitted: "pass" | "fail" | "n/a";
        data_available: "pass" | "pending" | "n/a";
        has_clicks_in_28d: "pass" | "fail" | "n/a";
    };
    next_actions: string[];
}
export declare function setupCheck(client: GscClient, authState: AuthState, siteUrl?: string): Promise<SetupReport>;
//# sourceMappingURL=setup-check.d.ts.map