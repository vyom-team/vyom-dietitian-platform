import { describe, expect, it } from "vitest";

import {
  DEFAULT_SIGNED_IN_PATH,
  isAuthPath,
  isProtectedPath,
  safeRedirectPath,
} from "../src/lib/auth/routes";
import {
  ASSIGNABLE_ORGANIZATION_ROLES,
  isAssignableOrganizationRole,
  isPlatformRole,
} from "../src/lib/auth/roles";

describe("route protection policy", () => {
  it.each([
    "/dashboard",
    "/dashboard/anything",
    "/clients",
    "/clients/123",
    "/plans",
    "/foods",
    "/reports",
    "/team",
    "/subscription",
    "/settings",
  ])("protects %s", (path) => {
    expect(isProtectedPath(path)).toBe(true);
  });

  it.each([
    "/",
    "/features",
    "/pricing",
    "/contact",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
  ])("leaves %s public", (path) => {
    expect(isProtectedPath(path)).toBe(false);
  });

  it("does not protect a path that merely starts with the same characters", () => {
    // "/settingsomething" must not match the "/settings" prefix.
    expect(isProtectedPath("/settingsomething")).toBe(false);
    expect(isProtectedPath("/teamwork")).toBe(false);
  });

  it("bounces signed-in users away from sign-in and registration", () => {
    expect(isAuthPath("/login")).toBe(true);
    expect(isAuthPath("/register")).toBe(true);
    expect(isAuthPath("/forgot-password")).toBe(true);
  });

  it("does NOT bounce signed-in users away from reset-password", () => {
    // The user holds a recovery session when they land there; redirecting would
    // break the very flow the page exists for.
    expect(isAuthPath("/reset-password")).toBe(false);
  });
});

describe("open redirect protection", () => {
  it("allows internal paths", () => {
    expect(safeRedirectPath("/clients")).toBe("/clients");
    expect(safeRedirectPath("/dashboard/settings")).toBe("/dashboard/settings");
  });

  it.each([
    ["https://evil.example", "absolute URL"],
    ["//evil.example", "protocol-relative URL"],
    ["/\\evil.example", "backslash trick"],
    ["javascript:alert(1)", "javascript scheme"],
    ["http://localhost:3000/dashboard", "absolute same-host URL"],
    ["evil", "bare relative path"],
    ["", "empty string"],
  ])("rejects %s (%s)", (candidate) => {
    expect(safeRedirectPath(candidate)).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("falls back for null and undefined", () => {
    expect(safeRedirectPath(null)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath(undefined)).toBe(DEFAULT_SIGNED_IN_PATH);
  });
});

describe("role assignment guards", () => {
  it("never lets organization code assign SUPER_ADMIN", () => {
    expect(isAssignableOrganizationRole("SUPER_ADMIN")).toBe(false);
    expect(ASSIGNABLE_ORGANIZATION_ROLES).not.toContain("SUPER_ADMIN");
  });

  it("never lets organization code assign CLIENT through team management", () => {
    expect(isAssignableOrganizationRole("CLIENT")).toBe(false);
  });

  it("allows the practitioner roles", () => {
    expect(isAssignableOrganizationRole("OWNER")).toBe(true);
    expect(isAssignableOrganizationRole("DIETITIAN")).toBe(true);
    expect(isAssignableOrganizationRole("RECEPTIONIST")).toBe(true);
  });

  it("rejects arbitrary strings", () => {
    expect(isAssignableOrganizationRole("ADMIN")).toBe(false);
    expect(isAssignableOrganizationRole("owner")).toBe(false);
    expect(isAssignableOrganizationRole("")).toBe(false);
  });

  it("identifies SUPER_ADMIN as a platform role", () => {
    expect(isPlatformRole("SUPER_ADMIN")).toBe(true);
    expect(isPlatformRole("OWNER")).toBe(false);
  });
});
