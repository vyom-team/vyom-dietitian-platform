"use client";

import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Combobox } from "@/components/shared/combobox";
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
import { getCountries, formatTimezoneLabel, getTimezones } from "@/lib/locale";
import {
  practiceDetailsSchema,
  type PracticeDetailsInput,
  type PracticeDetailsValues,
} from "@/validations/onboarding";

/** Step 1 — practice details. */
export function PracticeStep({
  defaultValues,
  onSubmit,
}: {
  defaultValues: PracticeDetailsValues;
  onSubmit: (values: PracticeDetailsInput) => void;
}) {
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
    // Three generics: the values the form holds, the context, and the
    // validated output. The schema transforms, so input and output differ.
  } = useForm<PracticeDetailsValues, unknown, PracticeDetailsInput>({
    resolver: zodResolver(practiceDetailsSchema),
    defaultValues,
    mode: "onBlur",
  });

  // Built once: ~250 countries and ~420 timezones are stable for the session.
  const countryOptions = useMemo(
    () => getCountries().map((c) => ({ value: c.code, label: c.label })),
    [],
  );
  const timezoneOptions = useMemo(
    () => getTimezones().map((zone) => ({ value: zone, label: formatTimezoneLabel(zone) })),
    [],
  );

  // useWatch rather than watch(): it subscribes to just these fields, and
  // unlike watch() it is stable enough for the React Compiler to reason about.
  const country = useWatch({ control, name: "country" });
  const timezone = useWatch({ control, name: "timezone" });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-8">
      <FieldSet>
        <FieldLegend>Practice details</FieldLegend>
        <FieldDescription>
          This appears on the plans and documents you share with clients.
        </FieldDescription>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="name">Practice name</FieldLabel>
            <Input
              id="name"
              placeholder="e.g. Healthy Life Nutrition"
              autoComplete="organization"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? "name-error" : undefined}
              {...register("name")}
            />
            {errors.name ? (
              <p id="name-error" className="text-sm text-destructive">
                {errors.name.message}
              </p>
            ) : null}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="country">Country</FieldLabel>
              <Combobox
                id="country"
                options={countryOptions}
                value={country}
                onChange={(value) =>
                  setValue("country", value, { shouldValidate: true })
                }
                placeholder="Select a country"
                searchPlaceholder="Search countries…"
                emptyMessage="No country found."
                invalid={Boolean(errors.country)}
                describedBy={errors.country ? "country-error" : undefined}
              />
              {errors.country ? (
                <p id="country-error" className="text-sm text-destructive">
                  {errors.country.message}
                </p>
              ) : null}
            </Field>

            <Field>
              <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
              <Combobox
                id="timezone"
                options={timezoneOptions}
                value={timezone}
                onChange={(value) =>
                  setValue("timezone", value, { shouldValidate: true })
                }
                placeholder="Select a timezone"
                searchPlaceholder="Search timezones…"
                emptyMessage="No timezone found."
                invalid={Boolean(errors.timezone)}
                describedBy="timezone-hint"
              />
              <FieldDescription id="timezone-hint">
                Used for follow-ups and log timestamps.
              </FieldDescription>
            </Field>
          </div>
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>Contact</FieldLegend>
        <FieldDescription>
          Optional. Separate from the email you sign in with.
        </FieldDescription>

        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="email">Practice email</FieldLabel>
              <Input
                id="email"
                type="email"
                placeholder="hello@practice.com"
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? "email-error" : undefined}
                {...register("email")}
              />
              {errors.email ? (
                <p id="email-error" className="text-sm text-destructive">
                  {errors.email.message}
                </p>
              ) : null}
            </Field>

            <Field>
              <FieldLabel htmlFor="phone">Practice phone</FieldLabel>
              <Input
                id="phone"
                type="tel"
                placeholder="+91 98765 43210"
                aria-invalid={errors.phone ? true : undefined}
                aria-describedby={errors.phone ? "phone-error" : undefined}
                {...register("phone")}
              />
              {errors.phone ? (
                <p id="phone-error" className="text-sm text-destructive">
                  {errors.phone.message}
                </p>
              ) : null}
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="website">Website</FieldLabel>
            <Input
              id="website"
              type="url"
              placeholder="https://practice.com"
              aria-invalid={errors.website ? true : undefined}
              aria-describedby={errors.website ? "website-error" : undefined}
              {...register("website")}
            />
            {errors.website ? (
              <p id="website-error" className="text-sm text-destructive">
                {errors.website.message}
              </p>
            ) : null}
          </Field>

          <Field>
            <FieldLabel htmlFor="addressLine">Address</FieldLabel>
            <Input
              id="addressLine"
              autoComplete="street-address"
              placeholder="Street address"
              {...register("addressLine")}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="city">City</FieldLabel>
              <Input id="city" autoComplete="address-level2" {...register("city")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="state">State</FieldLabel>
              <Input id="state" autoComplete="address-level1" {...register("state")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="postalCode">Postal code</FieldLabel>
              <Input
                id="postalCode"
                autoComplete="postal-code"
                {...register("postalCode")}
              />
            </Field>
          </div>
        </FieldGroup>
      </FieldSet>

      <div className="flex justify-end">
        <Button type="submit">Continue</Button>
      </div>
    </form>
  );
}
