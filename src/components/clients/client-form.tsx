"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

import { SubmitButton } from "@/components/auth/submit-button";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ClientActionState } from "@/lib/clients/actions";
import type { ClientDetail, AssignableMember } from "@/services/clients";
import { CLIENT_GENDERS, CLIENT_GENDER_LABELS } from "@/validations/client";

const initialState: ClientActionState = { status: "idle" };

/**
 * Client create/edit form.
 *
 * One form, four labelled sections — not a wizard. There are barely a dozen
 * fields and only two are required; splitting them across steps would add
 * ceremony without reducing effort.
 *
 * Note what is absent: no weight, height, condition, allergy, or medication
 * field. Those belong to the assessment models later phases introduce, and
 * adding them here would put clinical data behind administrative permissions.
 */
export function ClientForm({
  action,
  client,
  members,
  canAssign,
  submitLabel,
  pendingLabel,
  cancelHref,
}: {
  action: (state: ClientActionState, formData: FormData) => Promise<ClientActionState>;
  client?: ClientDetail;
  members?: AssignableMember[];
  /** Assignment is owner-only, and is edited from the profile after creation. */
  canAssign?: boolean;
  submitLabel: string;
  pendingLabel: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, initialState);

  const error = (field: string) => state.fieldErrors?.[field];

  return (
    <form action={formAction} noValidate className="space-y-8">
      {client ? <input type="hidden" name="clientId" value={client.id} /> : null}

      {state.status === "error" && state.message ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive-subtle p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="text-pretty">{state.message}</p>
        </div>
      ) : null}

      <FieldSet>
        <FieldLegend>Basic information</FieldLegend>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="firstName">First name</FieldLabel>
              <Input
                id="firstName"
                name="firstName"
                required
                autoComplete="off"
                defaultValue={client?.firstName}
                aria-invalid={error("firstName") ? true : undefined}
                aria-describedby={error("firstName") ? "firstName-error" : undefined}
              />
              <FieldError id="firstName-error" message={error("firstName")} />
            </Field>

            <Field>
              <FieldLabel htmlFor="lastName">Last name</FieldLabel>
              <Input
                id="lastName"
                name="lastName"
                required
                autoComplete="off"
                defaultValue={client?.lastName}
                aria-invalid={error("lastName") ? true : undefined}
                aria-describedby={error("lastName") ? "lastName-error" : undefined}
              />
              <FieldError id="lastName-error" message={error("lastName")} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="dateOfBirth">Date of birth</FieldLabel>
              <Input
                id="dateOfBirth"
                name="dateOfBirth"
                type="date"
                defaultValue={toDateInput(client?.dateOfBirth)}
                aria-invalid={error("dateOfBirth") ? true : undefined}
                aria-describedby={
                  error("dateOfBirth") ? "dateOfBirth-error" : "dob-hint"
                }
              />
              <FieldDescription id="dob-hint">Optional.</FieldDescription>
              <FieldError id="dateOfBirth-error" message={error("dateOfBirth")} />
            </Field>

            <Field>
              <FieldLabel htmlFor="gender">Gender</FieldLabel>
              <Select name="gender" defaultValue={client?.gender ?? undefined}>
                <SelectTrigger id="gender">
                  <SelectValue placeholder="Not specified" />
                </SelectTrigger>
                <SelectContent>
                  {CLIENT_GENDERS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {CLIENT_GENDER_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>Contact</FieldLegend>
        <FieldDescription>
          Optional. Not every client has an email address.
        </FieldDescription>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="off"
                defaultValue={client?.email ?? undefined}
                aria-invalid={error("email") ? true : undefined}
                aria-describedby={error("email") ? "email-error" : undefined}
              />
              <FieldError id="email-error" message={error("email")} />
            </Field>

            <Field>
              <FieldLabel htmlFor="phone">Phone</FieldLabel>
              <Input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="off"
                placeholder="+91 98765 43210"
                defaultValue={client?.phone ?? undefined}
                aria-invalid={error("phone") ? true : undefined}
                aria-describedby={error("phone") ? "phone-error" : undefined}
              />
              <FieldError id="phone-error" message={error("phone")} />
            </Field>
          </div>
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>Address</FieldLegend>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="addressLine">Address</FieldLabel>
            <Input
              id="addressLine"
              name="addressLine"
              autoComplete="off"
              defaultValue={client?.addressLine ?? undefined}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="city">City</FieldLabel>
              <Input id="city" name="city" defaultValue={client?.city ?? undefined} />
            </Field>
            <Field>
              <FieldLabel htmlFor="state">State</FieldLabel>
              <Input id="state" name="state" defaultValue={client?.state ?? undefined} />
            </Field>
            <Field>
              <FieldLabel htmlFor="postalCode">Postal code</FieldLabel>
              <Input
                id="postalCode"
                name="postalCode"
                defaultValue={client?.postalCode ?? undefined}
              />
            </Field>
          </div>
        </FieldGroup>
      </FieldSet>

      {canAssign && members ? (
        <>
          <FieldSeparator />
          <FieldSet>
            <FieldLegend>Practice assignment</FieldLegend>
            <FieldDescription>
              Who looks after this client. You can change this later.
            </FieldDescription>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="assignedMemberId">
                  Assigned dietitian
                </FieldLabel>
                <Select name="assignedMemberId" defaultValue="unassigned">
                  <SelectTrigger id="assignedMemberId">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {members.map((member) => (
                      <SelectItem
                        key={member.membershipId}
                        value={member.membershipId}
                      >
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Leaving this unassigned is fine — an owner can assign someone
                  later.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </FieldSet>
        </>
      ) : null}

      <div className="flex items-center justify-end gap-3 border-t pt-6">
        <Button type="button" variant="ghost" asChild>
          <Link href={cancelHref}>Cancel</Link>
        </Button>
        <SubmitButton pendingLabel={pendingLabel}>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  );
}

/** `<input type="date">` needs YYYY-MM-DD. */
function toDateInput(date?: Date | null): string | undefined {
  if (!date) return undefined;
  return new Date(date).toISOString().slice(0, 10);
}
