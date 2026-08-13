import { describe, expect, it } from "vitest";

import {
  generateInvitationToken,
  hashInvitationToken,
  invitationExpiryFromNow,
  isInvitationExpired,
  buildInvitationUrl,
  tokenHashesMatch,
  INVITATION_TTL_DAYS,
} from "../src/lib/invitation-token";
import {
  INVITABLE_ROLES,
  changeRoleSchema,
  inviteMemberSchema,
  isInvitableRole,
} from "../src/validations/team";
import { buildInvitationEmail } from "../src/services/email-templates";

/**
 * Team management security — the parts that can be proven without a database.
 * Database-backed behaviour lives in tests/team-service.test.ts.
 */

describe("invitation tokens", () => {
  it("generates a token and its hash", () => {
    const { token, tokenHash } = generateInvitationToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashInvitationToken(token));
  });

  it("never repeats a token", () => {
    const tokens = new Set(
      Array.from({ length: 500 }, () => generateInvitationToken().token),
    );
    expect(tokens.size).toBe(500);
  });

  it("produces URL-safe tokens", () => {
    for (let i = 0; i < 100; i += 1) {
      const { token } = generateInvitationToken();
      // base64url only. A token needing percent-encoding would break when
      // pasted or wrapped by a mail client.
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(encodeURIComponent(token)).toBe(token);
    }
  });

  it("is not derivable from the hash", () => {
    const { token, tokenHash } = generateInvitationToken();
    expect(tokenHash).not.toContain(token);
    expect(token).not.toContain(tokenHash);
  });

  it("compares hashes in constant time and rejects mismatches", () => {
    const a = hashInvitationToken("one");
    const b = hashInvitationToken("two");
    expect(tokenHashesMatch(a, a)).toBe(true);
    expect(tokenHashesMatch(a, b)).toBe(false);
    // Different lengths must not throw — that would itself be a signal.
    expect(tokenHashesMatch(a, "short")).toBe(false);
  });

  it("expires invitations after the documented window", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const expiry = invitationExpiryFromNow(now);
    const days = (expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(INVITATION_TTL_DAYS);

    expect(isInvitationExpired(expiry, now)).toBe(false);
    expect(
      isInvitationExpired(expiry, new Date(expiry.getTime() + 1)),
    ).toBe(true);
    // Exactly at the boundary counts as expired.
    expect(isInvitationExpired(expiry, expiry)).toBe(true);
  });

  it("never creates a non-expiring invitation", () => {
    const expiry = invitationExpiryFromNow();
    expect(Number.isFinite(expiry.getTime())).toBe(true);
    expect(expiry.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("invitation links", () => {
  it("builds a link on the configured origin", () => {
    const url = buildInvitationUrl("https://app.vyom.test", "abc123");
    expect(url).toBe("https://app.vyom.test/invite/abc123");
  });

  it("tolerates a trailing slash", () => {
    expect(buildInvitationUrl("https://app.vyom.test/", "abc")).toBe(
      "https://app.vyom.test/invite/abc",
    );
  });

  it("encodes the token into the path", () => {
    // Real tokens are base64url, but the builder must not emit a broken URL
    // if it is ever handed something else.
    const url = buildInvitationUrl("https://app.vyom.test", "a/b?c#d");
    expect(url).toBe("https://app.vyom.test/invite/a%2Fb%3Fc%23d");
    expect(new URL(url).pathname).toBe("/invite/a%2Fb%3Fc%23d");
  });
});

/**
 * Role restriction. The schema is the boundary: privileged roles are not merely
 * hidden in the UI, they fail validation before any code sees them.
 */
describe("role escalation is impossible through the payload", () => {
  const validInvite = { email: "colleague@practice.com", role: "DIETITIAN" };

  it.each(["SUPER_ADMIN", "OWNER", "CLIENT"])("rejects role %s on invite", (role) => {
    const result = inviteMemberSchema.safeParse({ ...validInvite, role });
    expect(result.success).toBe(false);
  });

  it.each(["SUPER_ADMIN", "OWNER", "CLIENT"])(
    "rejects role %s on role change",
    (role) => {
      const result = changeRoleSchema.safeParse({
        membershipId: "3f7c1a3e-2b6d-4f1e-9c8a-1d2e3f4a5b6c",
        role,
      });
      expect(result.success).toBe(false);
    },
  );

  it("only allows dietitian and receptionist", () => {
    expect([...INVITABLE_ROLES].sort()).toEqual(["DIETITIAN", "RECEPTIONIST"]);
    expect(isInvitableRole("DIETITIAN")).toBe(true);
    expect(isInvitableRole("RECEPTIONIST")).toBe(true);
    expect(isInvitableRole("OWNER")).toBe(false);
    expect(isInvitableRole("SUPER_ADMIN")).toBe(false);
  });

  it.each(["owner", "super_admin", "Dietitian", "", "ADMIN", "'; DROP TABLE"])(
    "rejects arbitrary role string %j",
    (role) => {
      expect(isInvitableRole(role)).toBe(false);
      expect(inviteMemberSchema.safeParse({ ...validInvite, role }).success).toBe(
        false,
      );
    },
  );

  it("drops an injected organizationId", () => {
    // organizationId is not in the schema at all — it comes from the session.
    const parsed = inviteMemberSchema.parse({
      ...validInvite,
      organizationId: "11111111-1111-1111-1111-111111111111",
    });
    expect(parsed).not.toHaveProperty("organizationId");
  });

  it("drops an injected userId and status", () => {
    const parsed = inviteMemberSchema.parse({
      ...validInvite,
      userId: "22222222-2222-2222-2222-222222222222",
      status: "ACCEPTED",
    });
    expect(parsed).not.toHaveProperty("userId");
    expect(parsed).not.toHaveProperty("status");
  });

  it("rejects a non-uuid membership id", () => {
    for (const membershipId of ["1", "abc", "../../etc", ""]) {
      expect(
        changeRoleSchema.safeParse({ membershipId, role: "DIETITIAN" }).success,
      ).toBe(false);
    }
  });
});

describe("invite email validation", () => {
  it("normalises to lowercase", () => {
    const parsed = inviteMemberSchema.parse({
      email: "  Colleague@Practice.COM  ",
      role: "DIETITIAN",
    });
    expect(parsed.email).toBe("colleague@practice.com");
  });

  it.each(["", "   ", "not-an-email", "a@", "@b.com", "a b@c.com"])(
    "rejects %j",
    (email) => {
      expect(inviteMemberSchema.safeParse({ email, role: "DIETITIAN" }).success).toBe(
        false,
      );
    },
  );

  it("caps the personal message length", () => {
    expect(
      inviteMemberSchema.safeParse({
        email: "a@b.com",
        role: "DIETITIAN",
        message: "x".repeat(501),
      }).success,
    ).toBe(false);
  });
});

describe("invitation email content", () => {
  const email = buildInvitationEmail({
    to: "colleague@practice.com",
    practiceName: "Healthy Life Nutrition",
    roleLabel: "Dietitian",
    inviterName: "Rahul Sharma",
    acceptUrl: "https://app.vyom.test/invite/tok",
    expiresAt: new Date("2026-02-01T00:00:00Z"),
  });

  it("addresses the invitee and names the practice", () => {
    expect(email.to).toBe("colleague@practice.com");
    expect(email.subject).toContain("Healthy Life Nutrition");
    expect(email.text).toContain("Dietitian");
    expect(email.text).toContain("https://app.vyom.test/invite/tok");
  });

  it("escapes interpolated values so they cannot form markup", () => {
    const hostile = buildInvitationEmail({
      to: "a@b.com",
      practiceName: "<script>alert(1)</script>",
      roleLabel: "Dietitian",
      inviterName: '"><img src=x onerror=alert(1)>',
      acceptUrl: "https://app.vyom.test/invite/tok",
      expiresAt: new Date(),
      message: "</p><iframe src=evil>",
    });

    /*
     * What matters is that the injected text cannot become an *element*. The
     * literal string "onerror=" may still appear as inert text — asserting its
     * absence would be testing the wrong thing — so assert instead that no tag
     * was formed and that the angle brackets were escaped.
     */
    expect(hostile.html).not.toMatch(/<script/i);
    expect(hostile.html).not.toMatch(/<img/i);
    expect(hostile.html).not.toMatch(/<iframe/i);
    expect(hostile.html).toContain("&lt;script&gt;");
    expect(hostile.html).toContain("&lt;img");
    expect(hostile.html).toContain("&lt;iframe");

    // Only the tags the template itself writes are present.
    const tags = [...hostile.html.matchAll(/<([a-z]+)[\s>]/gi)].map((m) =>
      m[1]!.toLowerCase(),
    );
    expect(new Set(tags)).toEqual(
      new Set(["div", "p", "a", "strong", "blockquote", "br"]),
    );
  });

  it("carries no client or health information", () => {
    // The plain-text body only. The HTML contains CSS such as `font-weight`,
    // which would trip a naive substring search without meaning anything.
    const body = email.text.toLowerCase();
    for (const term of ["weight", "calorie", "diagnosis", "patient", "bmi", "kg"]) {
      expect(body, `"${term}" must not appear in an invitation email`).not.toMatch(
        new RegExp(`\\b${term}\\b`),
      );
    }
  });
});
