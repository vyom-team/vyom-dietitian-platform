"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireAuth } from "@/lib/auth/dal";
import { DEFAULT_SIGNED_IN_PATH } from "@/lib/auth/routes";
import { createPractice } from "@/services/organizations";
import { createPracticeSchema } from "@/validations/onboarding";

/**
 * Practice creation Server Action.
 *
 * Thin by design: authorize, validate, delegate, redirect. The business logic
 * lives in `@/services/organizations` so it stays testable and so this file
 * has one obvious job.
 *
 * A Server Action is a public HTTP endpoint. Its argument is whatever the
 * caller chose to send — including a caller who never opened the wizard. So:
 *
 *   - the owner is taken from the session, never from the payload
 *   - the role is not in the payload at all (the service hard-codes OWNER)
 *   - the organization id and slug are generated server-side
 *   - the full payload is re-validated here, not trusted from the steps
 */

export type OnboardingState = {
  status: "idle" | "error";
  message?: string;
  /** Field errors keyed by dotted path, e.g. "practice.name". */
  fieldErrors?: Record<string, string>;
};

export async function createPracticeAction(
  _previous: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  // Identity comes from the verified session. This is the only source of the
  // owner id anywhere in the flow.
  const user = await requireAuth();

  /*
   * Server-side replay guard. `requireOnboardingAccess` already redirects a
   * user who has a practice, but a Server Action can be invoked directly
   * without ever rendering that page, so the check is repeated where the write
   * actually happens.
   */
  if (user.memberships.length > 0) {
    redirect(DEFAULT_SIGNED_IN_PATH);
  }

  const raw = formData.get("payload");

  if (typeof raw !== "string") {
    return { status: "error", message: "Something went wrong. Please try again." };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { status: "error", message: "Something went wrong. Please try again." };
  }

  const parsed = createPracticeSchema.safeParse(parsedJson);

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return {
      status: "error",
      message: "Please check the highlighted details and try again.",
      fieldErrors,
    };
  }

  const result = await createPractice(user.profileId, parsed.data);

  if (!result.ok) {
    if (result.reason === "already-member") {
      // Created by a concurrent submit between the guard above and the write.
      redirect(DEFAULT_SIGNED_IN_PATH);
    }

    // Deliberately generic. The real cause is already logged by the service;
    // surfacing a database message here would leak schema detail.
    return {
      status: "error",
      message: "We couldn't create your practice. Please try again.",
    };
  }

  // Membership changed, so every cached layout that read it is now stale.
  revalidatePath("/", "layout");
  redirect(DEFAULT_SIGNED_IN_PATH);
}
