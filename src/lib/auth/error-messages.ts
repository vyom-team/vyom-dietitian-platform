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
  | "email_rate_limited"
  | "email_invalid"
  | "weak_password"
  | "expired_link"
  | "session_expired"
  | "signup_disabled"
  | "unknown";

const MESSAGES: Record<AuthErrorCode, string> = {
  invalid_credentials: "Invalid email or password.",
  email_not_confirmed:
    "Please confirm your email address before signing in. Check your inbox for the link.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  /*
   * Distinct from generic rate limiting because the cause and the remedy are
   * different: nothing the user did is wrong, the mail sender is simply
   * saturated. Telling them to "try again" in a minute would be wrong — the
   * window is measured in tens of minutes.
   */
  email_rate_limited:
    "We can't send any more emails right now. Please wait about an hour and try again.",
  email_invalid: "That email address wasn't accepted. Please check it and try again.",
  weak_password: "Please choose a stronger password.",
  expired_link: "That link has expired. Please request a new one.",
  session_expired: "Your session has expired. Please sign in again.",
  signup_disabled: "New accounts are not being accepted at the moment.",
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
  // Checked before the generic 429 branch: both share status 429, and the
  // email-specific case needs its own remedy.
  if (
    code === "over_email_send_rate_limit" ||
    message.includes("email rate limit")
  ) {
    return "email_rate_limited";
  }
  if (code === "over_request_rate_limit" || error.status === 429 || message.includes("rate limit")) {
    return "rate_limited";
  }
  if (
    code === "email_address_invalid" ||
    code === "validation_failed" ||
    message.includes("is invalid")
  ) {
    return "email_invalid";
  }
  if (code === "signup_disabled" || message.includes("signups not allowed")) {
    return "signup_disabled";
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

/**
 * Classifies an auth error, logs the real one, and returns safe user copy.
 *
 * The logging matters. Showing the user a generic message is correct, but
 * *discarding* the provider's message leaves nobody able to diagnose a failure —
 * an unclassified error becomes an untraceable "Something went wrong". The log
 * stays server-side, so the detail never reaches the browser.
 *
 * Unclassified errors are logged at `error` level precisely so they get noticed
 * and given a proper message.
 *
 * @param context where the failure happened, e.g. "signUp"
 */
export function messageForError(
  error: { message?: string; code?: string; status?: number },
  context = "auth",
): string {
  const classified = classifyAuthError(error);

  const detail = {
    context,
    classified,
    code: error.code,
    status: error.status,
    message: error.message,
  };

  if (classified === "unknown") {
    console.error("[auth] unclassified provider error — add a case for this", detail);
  } else {
    console.warn("[auth] handled error", detail);
  }

  return authErrorMessage(classified);
}
