"use client";

import { useEffect, useState } from "react";

import { PracticeStep } from "@/components/onboarding/practice-step";
import { ProfileStep } from "@/components/onboarding/profile-step";
import { ReviewStep } from "@/components/onboarding/review-step";
import { Stepper, type Step } from "@/components/onboarding/stepper";
import { detectTimezone } from "@/lib/locale";
import type {
  OwnerProfileInput,
  PracticeDetailsInput,
} from "@/validations/onboarding";

const STEPS: readonly Step[] = [
  { id: "practice", label: "Practice" },
  { id: "profile", label: "Your profile" },
  { id: "review", label: "Review" },
];

/**
 * Three-step practice setup.
 *
 * State lives in React for the duration of the flow and is submitted once, at
 * the end. It is deliberately not persisted to `localStorage`: the flow is
 * short, and keeping a half-finished practice profile in browser storage is
 * needless exposure on a shared machine. A refresh restarts the wizard.
 *
 * Going back preserves what was already entered, so correcting a typo on the
 * review screen costs nothing.
 */
export function OnboardingWizard({
  defaultFullName,
}: {
  defaultFullName: string;
}) {
  const [stepIndex, setStepIndex] = useState(0);

  const [practice, setPractice] = useState<PracticeDetailsInput>({
    name: "",
    country: "IN",
    timezone: "Asia/Kolkata",
    email: undefined,
    phone: undefined,
    website: undefined,
    addressLine: undefined,
    city: undefined,
    state: undefined,
    postalCode: undefined,
  });

  const [owner, setOwner] = useState<OwnerProfileInput>({
    fullName: defaultFullName,
    professionalTitle: undefined,
    phone: undefined,
    bio: undefined,
  });

  /*
   * Pre-fill the timezone from the browser, as a suggestion the user sees and
   * can change on this very screen. Saving a detected zone silently would
   * mis-schedule every follow-up for anyone on a VPN or travelling.
   *
   * This must run *after* mount rather than in a lazy `useState` initializer:
   * the initializer also executes during server rendering, where it would read
   * the server's timezone and produce different markup from the client's — a
   * hydration mismatch on the value of a visible field.
   *
   * eslint-disable-next-line is deliberate. The rule guards against cascading
   * renders from effects that re-run; this has an empty dependency array, fires
   * once on mount, and reads a browser API that has no server equivalent —
   * exactly the "synchronise with an external system" case the rule documents
   * as legitimate.
   */
  useEffect(() => {
    const detected = detectTimezone();
    if (detected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setPractice((current) => ({ ...current, timezone: detected }));
    }
  }, []);

  return (
    <div className="space-y-10 py-4">
      <header className="space-y-2">
        <h1 className="type-h1">Set up your practice</h1>
        <p className="type-body text-pretty text-muted-foreground">
          A few details and you&apos;re ready to start working with clients.
        </p>
      </header>

      <Stepper steps={STEPS} currentIndex={stepIndex} />

      {stepIndex === 0 ? (
        <PracticeStep
          defaultValues={practice}
          onSubmit={(values) => {
            setPractice(values);
            setStepIndex(1);
          }}
        />
      ) : null}

      {stepIndex === 1 ? (
        <ProfileStep
          defaultValues={owner}
          onSubmit={(values) => {
            setOwner(values);
            setStepIndex(2);
          }}
          onBack={() => setStepIndex(0)}
        />
      ) : null}

      {stepIndex === 2 ? (
        <ReviewStep
          practice={practice}
          owner={owner}
          onBack={() => setStepIndex(1)}
        />
      ) : null}
    </div>
  );
}
