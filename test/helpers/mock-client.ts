/**
 * Shared mock GscClient factory for tool tests.
 */

import { vi } from "vitest";
import type { GscClient } from "../../src/gsc-client.js";

export function mockClient(overrides: Partial<GscClient> = {}): GscClient {
  return {
    listSites: vi.fn().mockResolvedValue([]),
    querySearchAnalytics: vi.fn().mockResolvedValue({ rows: [] }),
    inspectUrl: vi.fn(),
    listSitemaps: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as GscClient;
}
