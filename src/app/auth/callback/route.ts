import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SIGNED_IN_PATH, safeRedirectPath } from "@/lib/auth/routes";

/**
 * Supabase auth callback.
 *
 * Where email confirmation and password-recovery links land. Supabase issues a
 * one-time `code` which is exchanged here for a session cookie.
 *
 * Security notes:
 *
 *  - The redirect target is passed through `safeRedirectPath`, so a crafted
 *    `?next=https://evil.example` cannot bounce a freshly authenticated user
 *    off-site with a live session. This is the classic open-redirect sink in an
 *    OAuth-style callback.
 *
 *  - Redirects are built from `request.nextUrl.origin`, never from a
 *    caller-supplied host, so a spoofed Host header cannot relocate them.
 *
 *  - Failures land on a generic error screen; the provider's message is never
 *    reflected into the URL or the page.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const code = searchParams.get("code");
  const type = searchParams.get("type");
  const errorDescription = searchParams.get("error_description");

  // Supabase reports failures (expired or already-used links) on the query
  // string. Never echo the provider text back to the user.
  if (errorDescription) {
    return NextResponse.redirect(`${origin}/auth/auth-error?reason=link`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/auth-error?reason=missing`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/auth/auth-error?reason=link`);
  }

  /*
   * A recovery link establishes a session whose only purpose is setting a new
   * password, so it goes to the reset screen rather than the dashboard.
   */
  if (type === "recovery") {
    return NextResponse.redirect(`${origin}/reset-password`);
  }

  const destination = safeRedirectPath(
    searchParams.get("next"),
    DEFAULT_SIGNED_IN_PATH,
  );

  return NextResponse.redirect(`${origin}${destination}`);
}
