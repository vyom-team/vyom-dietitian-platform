import { describe, expect, it } from "vitest";

import {
  authErrorMessage,
  classifyAuthError,
} from "../src/lib/auth/error-messages";

/**
 * Provider error classification.
 *
 * These cases come from errors actually returned by Supabase during Phase 3
 * verification. Every one that previously fell through to "Something went
 * wrong" now has a message that tells the user what to do about it.
 */
describe("auth error classification", () => {
  it("maps the email send rate limit to its own message", () => {
    // Observed verbatim from Supabase when the built-in mailer is saturated.
    const code = classifyAuthError({
      code: "over_email_send_rate_limit",
      status: 429,
      message: "email rate limit exceeded",
    });
    expect(code).toBe("email_rate_limited");
    // Must not tell the user to "try again in a few minutes" — the real window
    // is far longer, and wrong advice is worse than vague advice.
    expect(authErrorMessage(code)).toMatch(/hour/i);
  });

  it("keeps generic request rate limiting separate", () => {
    expect(
      classifyAuthError({ code: "over_request_rate_limit", status: 429 }),
    ).toBe("rate_limited");
  });

  it("maps a rejected email address", () => {
    const code = classifyAuthError({
      code: "email_address_invalid",
      status: 400,
      message: 'Email address "x@example.com" is invalid',
    });
    expect(code).toBe("email_invalid");
    // The provider echoes the address back; our copy must not.
    expect(authErrorMessage(code)).not.toContain("example.com");
  });

  it("maps disabled signups", () => {
    expect(classifyAuthError({ code: "signup_disabled" })).toBe("signup_disabled");
  });

  it("maps invalid credentials", () => {
    expect(
      classifyAuthError({ message: "Invalid login credentials", status: 400 }),
    ).toBe("invalid_credentials");
  });

  it("maps unconfirmed email", () => {
    expect(classifyAuthError({ code: "email_not_confirmed" })).toBe(
      "email_not_confirmed",
    );
  });

  it("falls back to unknown for genuinely unrecognised errors", () => {
    expect(classifyAuthError({ message: "something entirely new" })).toBe(
      "unknown",
    );
  });

  it("never leaks provider text into user-facing copy", () => {
    const codes = [
      "invalid_credentials",
      "email_not_confirmed",
      "rate_limited",
      "email_rate_limited",
      "email_invalid",
      "weak_password",
      "expired_link",
      "session_expired",
      "signup_disabled",
      "unknown",
    ] as const;

    for (const code of codes) {
      const message = authErrorMessage(code);
      expect(message.length).toBeGreaterThan(0);
      // No stack traces, SQL, URLs, or internal identifiers.
      expect(message).not.toMatch(/https?:\/\/|supabase|postgres|at \w+\./i);
    }
  });

  it("does not confirm whether an account exists", () => {
    // Sign-in must read identically for a wrong password and an unknown user.
    expect(authErrorMessage("invalid_credentials")).toBe(
      "Invalid email or password.",
    );
  });
});
