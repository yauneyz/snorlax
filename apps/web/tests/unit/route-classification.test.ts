import { describe, expect, it } from "vitest";
import {
  classifyPath,
  isAuthenticatedUiRoute,
  isPasswordRecoveryPath,
} from "@/lib/auth/route-classification";

describe("route classification", () => {
  it("classifies authenticated UI routes from the shared route list", () => {
    expect(isAuthenticatedUiRoute("/app")).toBe(true);
    expect(isAuthenticatedUiRoute("/app/data-sources/gsc")).toBe(true);
    expect(isAuthenticatedUiRoute("/account")).toBe(true);
    expect(isAuthenticatedUiRoute("/account/billing")).toBe(true);
  });

  it("does not classify similarly-prefixed marketing routes as authenticated UI", () => {
    expect(isAuthenticatedUiRoute("/application")).toBe(false);
    expect(isAuthenticatedUiRoute("/accounting")).toBe(false);
  });

  it("keeps only the password recovery auth surface reachable after session creation", () => {
    expect(isPasswordRecoveryPath("/reset-password")).toBe(true);
    expect(isPasswordRecoveryPath("/login")).toBe(false);
    expect(isPasswordRecoveryPath("/reset-password/other")).toBe(false);
  });

  it("classifies public, auth, app, api, and asset routes", () => {
    expect(classifyPath("/")).toBe("marketing");
    expect(classifyPath("/pricing")).toBe("marketing");
    expect(classifyPath("/login")).toBe("auth");
    expect(classifyPath("/auth/recovery")).toBe("auth");
    expect(classifyPath("/app")).toBe("app");
    expect(classifyPath("/account")).toBe("app");
    expect(classifyPath("/api/health")).toBe("api");
    expect(classifyPath("/_next/static/chunk.js")).toBe("asset");
  });

  it("classifies brand and PWA files as assets so they load without a session", () => {
    for (const path of [
      "/favicon.ico",
      "/icon.svg",
      "/apple-icon.png",
      "/icons/icon-192.png",
      "/manifest.webmanifest",
      "/og-default.png",
    ]) {
      expect(classifyPath(path)).toBe("asset");
    }
  });
});
