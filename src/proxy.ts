import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy-session";

/**
 * Next.js 16 renamed Middleware to Proxy; this is the same request hook.
 *
 * It refreshes the Supabase session and performs optimistic redirects only.
 * Authorization decisions live in the Data Access Layer — see
 * `src/lib/auth/dal.ts` and the note in `proxy-session.ts`.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  /**
   * Runs on everything except static assets and image files.
   *
   * Auth deliberately runs on all *pages*, including public ones, so the
   * session is refreshed while a visitor browses the marketing site and they
   * are not signed out the moment they navigate into the app.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};
