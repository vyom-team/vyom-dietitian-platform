/**
 * Maps Supabase auth errors to user-facing copy.
 *
 * Two rules govern everything here:
 *
 *  1. Never leak internal detail. Raw provider messages can name internal
 *     endpoints, rate-limit internals, or configuration state.
 *
 *  2. Never enable account enumeration. Sign-in says "Invalid email or
 *     password" whether or not the address exists, and registration and
 *     password reset never confirm that an address is registered. An attacker
 *     must not be able to use these forms to build a list of customers — which
 *     for a healthcare product would itself be sensitive.
 */

export type AuthErrorCode =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "rate_limited"
  | "weak_password"
  | "expired_link"
  | "session_expired"
  | "unknown";

const MESSAGES: Record<AuthErrorCode, string> = {
  invalid_credentials: "Invalid email or password.",
  email_not_confirmed:
    "Please confirm your email address before signing in. Check your inbox for the link.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  weak_password: "Please choose a stronger password.",
  expired_link: "That link has expired. Please request a new one.",
  session_expired: "Your session has expired. Please sign in again.",
  unknown: "Something went wrong. Please try again.",
};

/** Classifies a Supabase error without exposing its text. */
export function classifyAuthError(error: {
  message?: string;
  code?: string;
  status?: number;
}): AuthErrorCode {
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();

  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "invalid_credentials";
  }
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return "email_not_confirmed";
  }
  if (code === "over_request_rate_limit" || error.status === 429 || message.includes("rate limit")) {
    return "rate_limited";
  }
  if (code === "weak_password" || message.includes("password should be")) {
    return "weak_password";
  }
  if (message.includes("expired") || message.includes("invalid token")) {
    return "expired_link";
  }
  if (code === "session_not_found" || message.includes("session")) {
    return "session_expired";
  }

  return "unknown";
}

export function authErrorMessage(code: AuthErrorCode): string {
  return MESSAGES[code];
}

export function messageForError(error: {
  message?: string;
  code?: string;
  status?: number;
}): string {
  return authErrorMessage(classifyAuthError(error));
}
