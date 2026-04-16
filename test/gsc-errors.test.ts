import { describe, it, expect } from "vitest";
import {
  translateError,
  GscApiError,
  ReauthRequired,
} from "../src/gsc-errors.js";

import revokedToken from "./fixtures/synthetic/revoked-token.json";
import insufficientScope from "./fixtures/synthetic/insufficient-scope.json";
import rateLimited from "./fixtures/synthetic/rate-limited-429.json";
import invalidProperty from "./fixtures/synthetic/invalid-property-404.json";
import urlNotUnderSite from "./fixtures/synthetic/url-not-under-site.json";

describe("translateError", () => {
  it("translates 401 UNAUTHENTICATED to ReauthRequired", () => {
    const err = { code: 401, message: revokedToken.error.message, errors: revokedToken.error.errors };
    const result = translateError(err);
    expect(result).toBeInstanceOf(ReauthRequired);
    expect(result.code).toBe("REAUTH_REQUIRED");
    expect(result.userMessage).toContain("revoked or expired");
    expect(result.userMessage).toContain("setup_check");
  });

  it("translates invalid_grant message to ReauthRequired", () => {
    const err = new Error("invalid_grant: Token has been expired or revoked");
    const result = translateError(err);
    expect(result).toBeInstanceOf(ReauthRequired);
  });

  it("translates 403 PERMISSION_DENIED (no property access)", () => {
    const err = {
      code: 403,
      message: "User does not have sufficient permission for site",
      errors: [{ reason: "forbidden" }],
    };
    const result = translateError(err, { siteUrl: "sc-domain:example.com" });
    expect(result.code).toBe("PERMISSION_DENIED");
    expect(result.userMessage).toContain("sc-domain:example.com");
    expect(result.userMessage).toContain("list_my_properties");
    expect(result.httpStatus).toBe(403);
  });

  it("translates 403 insufficient scope", () => {
    const err = {
      code: insufficientScope.error.code,
      message: insufficientScope.error.message,
      errors: insufficientScope.error.errors,
    };
    const result = translateError(err);
    expect(result.code).toBe("INSUFFICIENT_SCOPE");
    expect(result.userMessage).toContain("read-only");
  });

  it("translates 429 RESOURCE_EXHAUSTED", () => {
    const err = {
      code: rateLimited.error.code,
      message: rateLimited.error.message,
      errors: rateLimited.error.errors,
    };
    const result = translateError(err);
    expect(result.code).toBe("RATE_LIMITED");
    expect(result.userMessage).toContain("URL-inspection limit");
    expect(result.httpStatus).toBe(429);
  });

  it("translates 400 INVALID_ARGUMENT with site URL context", () => {
    const err = {
      code: urlNotUnderSite.error.code,
      message: urlNotUnderSite.error.message,
      errors: urlNotUnderSite.error.errors,
    };
    const result = translateError(err, { siteUrl: "sc-domain:bad-format" });
    expect(result.code).toBe("INVALID_ARGUMENT");
    expect(result.userMessage).toContain("sc-domain:bad-format");
    expect(result.userMessage).toContain("list_my_properties");
    expect(result.httpStatus).toBe(400);
  });

  it("translates 404 NOT_FOUND", () => {
    const err = {
      code: invalidProperty.error.code,
      message: invalidProperty.error.message,
      errors: invalidProperty.error.errors,
    };
    const result = translateError(err);
    expect(result.code).toBe("NOT_FOUND");
    expect(result.userMessage).toContain("list_my_properties");
    expect(result.httpStatus).toBe(404);
  });

  it("translates 5xx server errors", () => {
    const err = { code: 503, message: "Service Unavailable" };
    const result = translateError(err);
    expect(result.code).toBe("SERVER_ERROR");
    expect(result.userMessage).toContain("temporarily unavailable");
    expect(result.httpStatus).toBe(503);
  });

  it("translates network errors (ENOTFOUND)", () => {
    const err = new Error("getaddrinfo ENOTFOUND googleapis.com");
    const result = translateError(err);
    expect(result.code).toBe("NETWORK_ERROR");
    expect(result.userMessage).toContain("internet connection");
  });

  it("translates timeout errors", () => {
    const err = new Error("request timeout");
    const result = translateError(err);
    expect(result.code).toBe("TIMEOUT");
    expect(result.userMessage).toContain("internet connection");
  });

  it("passes through existing GscApiError unchanged", () => {
    const original = new GscApiError("CUSTOM", "custom message", 418);
    const result = translateError(original);
    expect(result).toBe(original);
  });

  it("falls back to UNKNOWN for unrecognized errors", () => {
    const err = Object.assign(new Error("I'm a teapot"), { code: 418 });
    const result = translateError(err);
    expect(result.code).toBe("UNKNOWN");
    expect(result.userMessage).toContain("I'm a teapot");
  });

  it("handles non-Error objects gracefully", () => {
    const result = translateError("string error");
    expect(result.code).toBe("UNKNOWN");
    expect(result.userMessage).toContain("string error");
  });
});
