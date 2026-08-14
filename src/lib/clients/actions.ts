"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireClientContext } from "@/lib/auth/dal";
import { ForbiddenError } from "@/lib/auth/errors";
import {
  assignClient,
  createClient,
  setClientStatus,
  updateClient,
  type Viewer,
} from "@/services/clients";
import {
  assignClientSchema,
  clientActionSchema,
  createClientSchema,
  updateClientSchema,
} from "@/validations/client";

/**
 * Client Server Actions.
 *
 * Every action resolves the practice from the **session**, never the request.
 * There is no `organizationId` field in any schema, so there is nothing to
 * tamper with — the entire class of cross-tenant attacks is removed by the
 * shape of the contract rather than by a check that could be forgotten.
 *
 * Role gates are applied per action, because they differ:
 *
 *   create / update  — owner, dietitian, receptionist
 *   archive/restore  — owner only
 *   assign           — owner only
 *
 * Archiving and assignment are owner-only deliberately. Neither is destructive,
 * but both change who is responsible for a client's care, and no finalised
 * business rule delegates them. Widening a permission later is safe; discovering
 * that a receptionist archived a caseload is not.
 */

export type ClientActionState = {
  status: "idle" | "error" | "success";
  message?: string;
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

function formValue(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

/** Reads every client field from a form. Shared by create and update. */
function clientFieldsFrom(formData: FormData) {
  return {
    firstName: formValue(formData, "firstName"),
    lastName: formValue(formData, "lastName"),
    email: formValue(formData, "email"),
    phone: formValue(formData, "phone"),
    dateOfBirth: formValue(formData, "dateOfBirth"),
    gender: formValue(formData, "gender"),
    addressLine: formValue(formData, "addressLine"),
    city: formValue(formData, "city"),
    state: formValue(formData, "state"),
    postalCode: formValue(formData, "postalCode"),
    country: formValue(formData, "country"),
  };
}

/** Owner-only gate for actions that change responsibility or lifecycle. */
function requireOwner(viewer: Viewer) {
  if (viewer.role !== "OWNER" && viewer.role !== "SUPER_ADMIN") {
    throw new ForbiddenError();
  }
}

// ---------------------------------------------------------------------------

export async function createClientAction(
  _previous: ClientActionState,
  formData: FormData,
): Promise<ClientActionState> {
  const { user, viewer } = await requireClientContext();

  const parsed = createClientSchema.safeParse({
    ...clientFieldsFrom(formData),
    assignedMemberId: formValue(formData, "assignedMemberId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const result = await createClient(viewer, user.profileId, parsed.data);

  if (!result.ok) {
    return {
      status: "error",
      message:
        result.reason === "invalid-assignee"
          ? "Select a team member from your practice."
          : "Unable to create client. Please try again.",
    };
  }

  revalidatePath("/clients");
  redirect(`/clients/${result.data.id}`);
}

// ---------------------------------------------------------------------------

export async function updateClientAction(
  _previous: ClientActionState,
  formData: FormData,
): Promise<ClientActionState> {
  const { viewer } = await requireClientContext();

  const parsed = updateClientSchema.safeParse({
    clientId: formValue(formData, "clientId"),
    ...clientFieldsFrom(formData),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const result = await updateClient(viewer, parsed.data);

  if (!result.ok) {
    return {
      status: "error",
      message:
        result.reason === "not-found"
          ? "That client could not be found."
          : "Unable to update client. Please try again.",
    };
  }

  revalidatePath(`/clients/${parsed.data.clientId}`);
  revalidatePath("/clients");
  redirect(`/clients/${parsed.data.clientId}`);
}

// ---------------------------------------------------------------------------

export async function archiveClientAction(
  _previous: ClientActionState,
  formData: FormData,
): Promise<ClientActionState> {
  return changeStatus(formData, "ARCHIVED", "Client archived.");
}

export async function restoreClientAction(
  _previous: ClientActionState,
  formData: FormData,
): Promise<ClientActionState> {
  return changeStatus(formData, "ACTIVE", "Client restored.");
}

async function changeStatus(
  formData: FormData,
  status: "ACTIVE" | "ARCHIVED",
  successMessage: string,
): Promise<ClientActionState> {
  const { viewer } = await requireClientContext();
  requireOwner(viewer);

  const parsed = clientActionSchema.safeParse({
    clientId: formValue(formData, "clientId"),
  });

  if (!parsed.success) {
    return { status: "error", message: "That client could not be found." };
  }

  const result = await setClientStatus(viewer, parsed.data.clientId, status);

  if (!result.ok) {
    return {
      status: "error",
      message:
        result.reason === "not-found"
          ? "That client could not be found."
          : `Unable to ${status === "ARCHIVED" ? "archive" : "restore"} client. Please try again.`,
    };
  }

  revalidatePath(`/clients/${parsed.data.clientId}`);
  revalidatePath("/clients");
  return { status: "success", message: successMessage };
}

// ---------------------------------------------------------------------------

export async function assignClientAction(
  _previous: ClientActionState,
  formData: FormData,
): Promise<ClientActionState> {
  const { viewer } = await requireClientContext();
  requireOwner(viewer);

  const parsed = assignClientSchema.safeParse({
    clientId: formValue(formData, "clientId"),
    assignedMemberId: formValue(formData, "assignedMemberId"),
  });

  if (!parsed.success) {
    return { status: "error", message: "Select a valid team member." };
  }

  const result = await assignClient(
    viewer,
    parsed.data.clientId,
    parsed.data.assignedMemberId ?? null,
  );

  if (!result.ok) {
    return {
      status: "error",
      message:
        result.reason === "invalid-assignee"
          ? "Select a team member from your practice."
          : result.reason === "not-found"
            ? "That client could not be found."
            : "Unable to update assignment. Please try again.",
    };
  }

  revalidatePath(`/clients/${parsed.data.clientId}`);
  revalidatePath("/clients");
  return {
    status: "success",
    message: parsed.data.assignedMemberId
      ? "Client assigned."
      : "Client unassigned.",
  };
}
