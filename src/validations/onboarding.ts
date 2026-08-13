import { z } from "zod";

/**
 * Practice onboarding schemas.
 *
 * Shared by the client wizard and the Server Action. The client copy gives
 * immediate feedback; the server copy is the one that decides, because a Server
 * Action is a public endpoint and its arguments are attacker-controlled.
 *
 * Note what is *absent*: no `role`, no `userId`, no `organizationId`, no `slug`,
 * no `status`. Those are determined by the server. If they were accepted here,
 * a crafted request could make its sender an OWNER of someone else's practice —
 * so they are not part of the input contract at all.
 */

const trimmedOptional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === "" ? undefined : value));

/**
 * Practice name.
 *
 * Deliberately permissive about characters: practice names legitimately contain
 * ampersands, apostrophes, accents, and Devanagari. Restricting to ASCII would
 * exclude real Indian practices. The name is escaped at render time, and the
 * URL-safe form is the separately-generated slug — so there is no injection
 * reason to narrow this.
 */
const practiceName = z
  .string()
  .trim()
  .min(2, "Enter your practice name")
  .max(120, "Practice name must be 120 characters or fewer")
  .refine((value) => /\p{L}|\p{N}/u.test(value), {
    message: "Practice name must contain at least one letter or number",
  });

/** ISO 3166-1 alpha-2. Uppercased so casing never causes a false mismatch. */
const country = z
  .string()
  .trim()
  .length(2, "Select a country")
  .transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z]{2}$/.test(value), "Select a country");

/**
 * IANA timezone identifier.
 *
 * Validated against the runtime's own timezone database rather than a regex, so
 * a plausible-looking but non-existent zone like "Asia/Atlantis" is rejected.
 */
const timezone = z
  .string()
  .trim()
  .min(1, "Select a timezone")
  .max(64)
  .refine(isValidTimeZone, "Select a valid timezone");

/**
 * Whether `value` is a usable IANA timezone identifier.
 *
 * "Does ICU accept it" is *not* sufficient on its own. ICU silently resolves
 * abbreviations to a guess: `IST` becomes `Asia/Calcutta` and — far worse —
 * `EST` becomes `America/Panama`, which does not observe daylight saving. A
 * practice storing "EST" would have every follow-up drift by an hour for half
 * the year.
 *
 * So an identifier must also be *region-qualified*: `Region/City`, or the one
 * legitimate exception, `UTC`. That admits both `Asia/Kolkata` and its older
 * spelling `Asia/Calcutta` — different runtimes canonicalise differently and
 * both are correct — while rejecting every ambiguous abbreviation.
 */
export function isValidTimeZone(value: string): boolean {
  if (value !== "UTC" && !value.includes("/")) return false;

  try {
    // Throws RangeError for an identifier ICU cannot resolve at all.
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Website URL.
 *
 * Only http and https are accepted. `javascript:` and `data:` URLs are the
 * reason: this value is rendered as a link, and either scheme would turn a
 * stored practice profile into a cross-site scripting vector for anyone who
 * clicks it.
 */
const website = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((value) => (value === "" ? undefined : value))
  .refine(
    (value) => {
      if (!value) return true;
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        return false;
      }
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    },
    { message: "Enter a full URL starting with http:// or https://" },
  );

/**
 * Phone number.
 *
 * Intentionally loose. A full international phone library is out of scope here,
 * and over-strict patterns reject valid numbers — which is worse than storing a
 * slightly untidy one. This rejects obvious junk and nothing more.
 */
const phone = z
  .string()
  .trim()
  .max(32)
  .optional()
  .transform((value) => (value === "" ? undefined : value))
  .refine((value) => !value || /^[+0-9][0-9\s().-]{5,}$/.test(value), {
    message: "Enter a valid phone number",
  });

const optionalEmail = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((value) => (value === "" ? undefined : value?.toLowerCase()))
  .refine((value) => !value || z.email().safeParse(value).success, {
    message: "Enter a valid email address",
  });

/** Step 1 — practice details. */
export const practiceDetailsSchema = z.object({
  name: practiceName,
  country,
  timezone,
  email: optionalEmail,
  phone,
  website,
  addressLine: trimmedOptional(200),
  city: trimmedOptional(100),
  state: trimmedOptional(100),
  postalCode: trimmedOptional(20),
});

/** Step 2 — the owner's professional profile. */
export const ownerProfileSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Enter your full name")
    .max(120, "Name must be 120 characters or fewer"),
  professionalTitle: trimmedOptional(120),
  phone,
  bio: trimmedOptional(1000),
});

/**
 * The complete payload submitted at the end of the wizard.
 *
 * The Server Action validates this in full rather than trusting that each step
 * was validated on the way through — the steps are client-side and could be
 * skipped entirely by posting directly to the action.
 */
export const createPracticeSchema = z.object({
  practice: practiceDetailsSchema,
  owner: ownerProfileSchema,
});

/*
 * Input vs output types.
 *
 * These schemas use `.transform()` (trimming, lowercasing, "" → undefined), so
 * what a form holds is not what validation produces. React Hook Form needs both:
 * `*Values` for the field values it manages, `*Input` for the validated result
 * handed to the submit handler. Conflating them is what produces the
 * "Resolver is not assignable" error.
 */
export type PracticeDetailsValues = z.input<typeof practiceDetailsSchema>;
export type PracticeDetailsInput = z.output<typeof practiceDetailsSchema>;

export type OwnerProfileValues = z.input<typeof ownerProfileSchema>;
export type OwnerProfileInput = z.output<typeof ownerProfileSchema>;

export type CreatePracticeInput = z.output<typeof createPracticeSchema>;
