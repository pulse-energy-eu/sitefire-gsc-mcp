import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// Mock fs and child_process before importing auth
vi.mock("node:fs");
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

// Use a test-safe token path
const TEST_TOKEN_DIR = "/tmp/.sitefire-gsc-test";
const TEST_TOKEN_PATH = path.join(TEST_TOKEN_DIR, "token.json");

describe("auth module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("tokenExists", () => {
    it("returns false when token file does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const { tokenExists } = await import("../src/auth.js");
      expect(tokenExists()).toBe(false);
    });

    it("returns true when token file exists", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const { tokenExists } = await import("../src/auth.js");
      expect(tokenExists()).toBe(true);
    });
  });

  describe("deleteToken", () => {
    it("deletes the token file when it exists", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
      const { deleteToken } = await import("../src/auth.js");
      deleteToken();
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it("does nothing when token file does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const { deleteToken } = await import("../src/auth.js");
      deleteToken();
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  describe("checkAuth", () => {
    it("returns missing when no token file", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const { checkAuth } = await import("../src/auth.js");
      const result = await checkAuth();
      expect(result.status).toBe("missing");
      expect(result.message).toContain("No Google authorization");
    });
  });

  describe("getTokenPath", () => {
    it("returns a path ending in token.json", async () => {
      const { getTokenPath } = await import("../src/auth.js");
      const p = getTokenPath();
      expect(p).toMatch(/token\.json$/);
      expect(p).toContain(".sitefire-gsc");
    });
  });
});
