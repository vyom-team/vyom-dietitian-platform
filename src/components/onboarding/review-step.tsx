"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";

import { SubmitButton } from "@/components/auth/submit-button";
import { Button } from "@/components/ui/button";
import { getCountryLabel } from "@/lib/locale";
import { createPracticeAction, type OnboardingState } from "@/lib/onboarding/actions";
import type {
  OwnerProfileInput,
  PracticeDetailsInput,
} from "@/validations/onboarding";

const initialState: OnboardingState = { status: "idle" };

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="grid gap-0.5 py-3 sm:grid-cols-3 sm:gap-4">
      <dt className="type-caption sm:pt-0.5">{label}</dt>
      <dd className="type-body sm:col-span-2">{value}</dd>
    </div>
  );
}

/**
 * Step 3 — review and create.
 *
 * The whole payload is posted as one JSON field. The server re-validates it in
 * full: the earlier steps ran in the browser and could have been skipped
 * entirely by posting here directly.
 */
export function ReviewStep({
  practice,
  owner,
  onBack,
}: {
  practice: PracticeDetailsInput;
  owner: OwnerProfileInput;
  onBack: () => void;
}) {
  const [state, formAction] = useActionState(createPracticeAction, initialState);

  const addressParts = [
    practice.addressLine,
    practice.city,
    practice.state,
    practice.postalCode,
  ].filter(Boolean);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h2 className="type-h3">Review and create</h2>
        <p className="type-body-sm text-muted-foreground">
          Check the details below. You can change any of this later in settings.
        </p>
      </div>

      {state.status === "error" && state.message ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive-subtle p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="text-pretty">{state.message}</p>
        </div>
      ) : null}

      <section className="rounded-xl border bg-card px-5">
        <h3 className="type-caption border-b py-3 font-medium tracking-wide uppercase">
          Practice
        </h3>
        <dl className="divide-y">
          <Row label="Name" value={practice.name} />
          <Row label="Country" value={getCountryLabel(practice.country)} />
          <Row label="Timezone" value={practice.timezone} />
          <Row label="Email" value={practice.email} />
          <Row label="Phone" value={practice.phone} />
          <Row label="Website" value={practice.website} />
          <Row
            label="Address"
            value={addressParts.length ? addressParts.join(", ") : undefined}
          />
        </dl>
      </section>

      <section className="rounded-xl border bg-card px-5">
        <h3 className="type-caption border-b py-3 font-medium tracking-wide uppercase">
          Owner
        </h3>
        <dl className="divide-y">
          <Row label="Name" value={owner.fullName} />
          <Row label="Title" value={owner.professionalTitle} />
          <Row label="Phone" value={owner.phone} />
          <Row label="About" value={owner.bio} />
          {/*
            Role is displayed, never chosen. The server assigns OWNER to whoever
            creates the practice; there is no control here and no role field in
            the submitted payload.
          */}
          <Row label="Role" value="Practice owner" />
        </dl>
      </section>

      <form action={formAction} className="flex items-center justify-between">
        <input
          type="hidden"
          name="payload"
          value={JSON.stringify({ practice, owner })}
        />
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <SubmitButton pendingLabel="Creating your practice…">
          Create my practice
        </SubmitButton>
      </form>
    </div>
  );
}
