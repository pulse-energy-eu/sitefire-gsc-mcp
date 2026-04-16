#!/usr/bin/env node

/**
 * sitefire-gsc-mcp — MCP server entry point.
 *
 * Registers tools, validates auth on startup (soft-fail),
 * and connects via stdio transport.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { getAuthClient, checkAuth, tokenExists } from "./auth.js";
import { GscClient } from "./gsc-client.js";
import { GscApiError } from "./gsc-errors.js";

import { listMyProperties } from "./tools/list-my-properties.js";
import { setupCheck } from "./tools/setup-check.js";
import { inspectUrlTool } from "./tools/inspect-url.js";
import { findOpportunities } from "./tools/find-opportunities.js";

const VERSION = "0.1.0";

function toolErrorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

function toolResult(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

async function getClient(): Promise<GscClient> {
  const auth = await getAuthClient();
  return new GscClient(auth);
}

function registerTools(server: McpServer) {
  // 1. list_my_properties
  server.registerTool(
    "list_my_properties",
    {
      description:
        "List all Google Search Console properties (sites) accessible under your Google account. Use this to see which sites you can query.",
      inputSchema: {},
      annotations: {
        title: "List my properties",
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async () => {
      try {
        const client = await getClient();
        const result = await listMyProperties(client);
        return toolResult(result as unknown as Record<string, unknown>);
      } catch (err) {
        if (err instanceof GscApiError) return toolErrorResult(err.userMessage);
        throw err;
      }
    },
  );

  // 2. setup_check
  server.registerTool(
    "setup_check",
    {
      description:
        "Check if everything is configured correctly: auth, property access, sitemaps, data availability. Run this first to diagnose setup issues.",
      inputSchema: {
        site_url: z
          .string()
          .optional()
          .describe(
            'Property URL to check, e.g. "sc-domain:sitefire.ai" or "https://sitefire.ai/". If omitted and you have exactly one property, it auto-selects.',
          ),
      },
      annotations: {
        title: "Setup check",
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ site_url }: { site_url?: string }) => {
      try {
        const authState = await checkAuth();
        const client = await getClient();
        const result = await setupCheck(client, authState, site_url);
        return toolResult(result as unknown as Record<string, unknown>);
      } catch (err) {
        if (err instanceof GscApiError) return toolErrorResult(err.userMessage);
        throw err;
      }
    },
  );

  // 3. inspect_url
  server.registerTool(
    "inspect_url",
    {
      description:
        "Inspect what Google knows about a specific URL: index status, crawl info, canonical, mobile usability, and a plain-English interpretation.",
      inputSchema: {
        site_url: z
          .string()
          .describe(
            'The GSC property, e.g. "sc-domain:sitefire.ai" or "https://sitefire.ai/".',
          ),
        url: z
          .string()
          .describe("The full URL to inspect, e.g. https://sitefire.ai/blog/my-post."),
      },
      annotations: {
        title: "Inspect URL",
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ site_url, url }: { site_url: string; url: string }) => {
      try {
        const client = await getClient();
        const result = await inspectUrlTool(client, site_url, url);
        return toolResult(result as unknown as Record<string, unknown>);
      } catch (err) {
        if (err instanceof GscApiError) return toolErrorResult(err.userMessage);
        throw err;
      }
    },
  );

  // 4. find_opportunities
  server.registerTool(
    "find_opportunities",
    {
      description:
        "Find growth opportunities for your Google traffic: striking-distance queries (positions 11-20), low-hanging fruit (high impressions, low CTR), and zero-click queries.",
      inputSchema: {
        site_url: z
          .string()
          .describe(
            'The GSC property, e.g. "sc-domain:sitefire.ai".',
          ),
        days: z
          .number()
          .int()
          .min(1)
          .max(90)
          .optional()
          .describe("Lookback window in days (default 28)."),
      },
      annotations: {
        title: "Find opportunities",
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ site_url, days }: { site_url: string; days?: number }) => {
      try {
        const client = await getClient();
        const result = await findOpportunities(client, site_url, days);
        return toolResult(result as unknown as Record<string, unknown>);
      } catch (err) {
        if (err instanceof GscApiError) return toolErrorResult(err.userMessage);
        throw err;
      }
    },
  );
}

async function startupBanner() {
  const hasToken = tokenExists();
  if (!hasToken) {
    process.stderr.write(
      `sitefire-gsc-mcp v${VERSION} - no Google authorization yet. All tools will route you through setup_check to complete the OAuth flow.\n`,
    );
    return;
  }

  try {
    const authState = await checkAuth();
    if (authState.status === "valid") {
      try {
        const client = await getClient();
        const sites = await client.listSites();
        process.stderr.write(
          `sitefire-gsc-mcp v${VERSION} - connected. ${sites.length} accessible ${sites.length === 1 ? "property" : "properties"} found.\n`,
        );
      } catch {
        process.stderr.write(
          `sitefire-gsc-mcp v${VERSION} - authorized but could not list properties. Tools will retry on first invocation.\n`,
        );
      }
    } else if (authState.status === "invalid") {
      process.stderr.write(
        `sitefire-gsc-mcp v${VERSION} - ${authState.message}\n`,
      );
    } else {
      process.stderr.write(
        `sitefire-gsc-mcp v${VERSION} - could not validate authorization. Tools will retry on first invocation.\n`,
      );
    }
  } catch {
    process.stderr.write(
      `sitefire-gsc-mcp v${VERSION} - could not reach Google to validate authorization. Tools will retry on first invocation.\n`,
    );
  }
}

async function main() {
  await startupBanner();

  const server = new McpServer({
    name: "sitefire-gsc-mcp",
    version: VERSION,
  });

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
