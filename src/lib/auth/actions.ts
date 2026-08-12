"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SIGNED_IN_PATH, safeRedirectPath } from "@/lib/auth/routes";
import { messageForError } from "@/lib/auth/error-messages";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "@/lib/auth/validation";

/**
 * Authentication Server Actions.
 *
 * Every action re-validates its input with the same Zod schema the form uses.
 * Client-side validation is a convenience for the user; the copy that runs here
 * is the one that counts, because a Server Action is a public HTTP endpoint and
 * its arguments are entirely attacker-controlled.
 *
 * Passwords are handed straight to Supabase Auth and never touch our database.
 */

export type ActionState = {
  status: "idle" | "error" | "success";
  message?: string;
  /** Field-level errors keyed by form field name. */
  fieldErrors?: Record<string, string>;
};

function fieldErrorsFrom(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !result[key]) result[key] = issue.message;
  }
  return result;
}

/**
 * Absolute origin for auth email links.
 *
 * Read from the request rather than hard-coded so local, preview, and
 * production each produce their own correct links.
 */
async function getOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");

  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const protocol = headerList.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

// ---------------------------------------------------------------------------

export async function signIn(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    redirectTo: formData.get("redirectTo"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return {
      status: "error",
      message: "Authentication is not configured on this environment.",
    };
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { status: "error", message: messageForError(error) };
  }

  // Validated against the allowlist so `?next=` cannot bounce a freshly
  // authenticated user to an attacker-controlled site.
  const destination = safeRedirectPath(parsed.data.redirectTo);

  revalidatePath("/", "layout");
  redirect(destination);
}

// ---------------------------------------------------------------------------

export async function signUp(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = registerSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return {
      status: "error",
      message: "Authentication is not configured on this environment.",
    };
  }

  const origin = await getOrigin();

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Read by the database trigger to populate user_profiles.full_name. The
      // profile row itself is created by that trigger, never by the browser.
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    return { status: "error", message: messageForError(error) };
  }

  /*
   * Deliberately identical whether or not the address was already registered.
   * Supabase returns success with an empty identities array for an existing
   * user; surfacing that difference would turn this form into an account
   * enumeration oracle.
   */
  return {
    status: "success",
    message: "Check your email for a confirmation link.",
  };
}

// ---------------------------------------------------------------------------

export async function requestPasswordReset(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  try {
    const supabase = await createClient();
    const origin = await getOrigin();

    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${origin}/auth/callback?type=recovery`,
    });
  } catch {
    // Swallowed on purpose — see the response below.
  }

  /*
   * Always the same answer, even on failure. Reporting "no account found" would
   * confirm whether an address belongs to a Vyom user, which for a healthcare
   * product leaks that someone is under dietetic care.
   */
  return {
    status: "success",
    message:
      "If that email is registered, a reset link is on its way. Check your inbox.",
  };
}

// ---------------------------------------------------------------------------

export async function updatePassword(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return {
      status: "error",
      message: "Authentication is not configured on this environment.",
    };
  }

  /*
   * Requires the recovery session established by the emailed link. Without it
   * updateUser fails — which is what stops a signed-out visitor from setting
   * somebody else's password by posting to this action directly.
   */
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      status: "error",
      message: "That reset link has expired. Please request a new one.",
    };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    return { status: "error", message: messageForError(error) };
  }

  revalidatePath("/", "layout");
  redirect(DEFAULT_SIGNED_IN_PATH);
}

// ---------------------------------------------------------------------------

export async function signOut(): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Even if the provider call fails, fall through to the redirect. The
    // session cookie is cleared by the proxy on the next request, and leaving
    // the user stranded on a broken page is worse.
  }

  revalidatePath("/", "layout");
  redirect("/");
}
