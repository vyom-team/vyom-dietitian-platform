"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ownerProfileSchema,
  type OwnerProfileInput,
  type OwnerProfileValues,
} from "@/validations/onboarding";

/**
 * Step 2 — the owner's professional profile.
 *
 * This updates the profile that already exists for the signed-in user. It never
 * creates a second account, and it has no role field: the creator of a practice
 * becomes its OWNER by virtue of creating it, decided on the server.
 */
export function ProfileStep({
  defaultValues,
  onSubmit,
  onBack,
}: {
  defaultValues: OwnerProfileValues;
  onSubmit: (values: OwnerProfileInput) => void;
  onBack: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<OwnerProfileValues, unknown, OwnerProfileInput>({
    resolver: zodResolver(ownerProfileSchema),
    defaultValues,
    mode: "onBlur",
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-8">
      <FieldSet>
        <FieldLegend>Your profile</FieldLegend>
        <FieldDescription>
          Shown to your clients on the plans you share with them.
        </FieldDescription>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="fullName">Full name</FieldLabel>
            <Input
              id="fullName"
              autoComplete="name"
              aria-invalid={errors.fullName ? true : undefined}
              aria-describedby={errors.fullName ? "fullName-error" : undefined}
              {...register("fullName")}
            />
            {errors.fullName ? (
              <p id="fullName-error" className="text-sm text-destructive">
                {errors.fullName.message}
              </p>
            ) : null}
          </Field>

          <Field>
            <FieldLabel htmlFor="professionalTitle">
              Professional title
            </FieldLabel>
            <Input
              id="professionalTitle"
              placeholder="e.g. Registered Dietitian"
              aria-describedby="title-hint"
              {...register("professionalTitle")}
            />
            <FieldDescription id="title-hint">
              Optional. Your credential as you would like clients to see it.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="ownerPhone">Phone</FieldLabel>
            <Input
              id="ownerPhone"
              type="tel"
              autoComplete="tel"
              placeholder="+91 98765 43210"
              aria-invalid={errors.phone ? true : undefined}
              aria-describedby={errors.phone ? "ownerPhone-error" : undefined}
              {...register("phone")}
            />
            {errors.phone ? (
              <p id="ownerPhone-error" className="text-sm text-destructive">
                {errors.phone.message}
              </p>
            ) : null}
          </Field>

          <Field>
            <FieldLabel htmlFor="bio">About you</FieldLabel>
            <Textarea
              id="bio"
              rows={4}
              placeholder="A short introduction for your clients."
              aria-describedby="bio-hint"
              {...register("bio")}
            />
            <FieldDescription id="bio-hint">
              Optional. You can add this later.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </FieldSet>

      <div className="flex justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="submit">Continue</Button>
      </div>
    </form>
  );
}
