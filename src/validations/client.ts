import { z } from "zod";

/**
 * Client schemas.
 *
 * Shared by the forms and the Server Actions. As everywhere else, the fields an
 * attacker would want are simply not part of the contract: no `organizationId`,
 * no `clientNumber`, no `status`, no `archivedAt`. Those are decided by the
 * server, so a crafted payload has nothing to grip.
 *
 * Phase 6 stores identity, contact, and address only. No weight, height, BMI,
 * condition, allergy, or medication field appears here — those belong to the
 * assessment models later phases introduce, with their own permissions.
 */

export const CLIENT_GENDERS = [
  "FEMALE",
  "MALE",
  "OTHER",
  "UNDISCLOSED",
] as const;

export type ClientGenderValue = (typeof CLIENT_GENDERS)[number];

export const CLIENT_GENDER_LABELS: Record<ClientGenderValue, string> = {
  FEMALE: "Female",
  MALE: "Male",
  OTHER: "Other",
  UNDISCLOSED: "Prefer not to say",
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === "" ? undefined : value));

/**
 * A person's name.
 *
 * Permissive by design. Indian names contain spaces, hyphens, apostrophes, and
 * Devanagari; a `[A-Za-z]+` rule would reject real clients, which is a far worse
 * failure than accepting an odd string. The only requirement is that it contains
 * a letter, so whitespace and punctuation alone are rejected. Output is escaped
 * at render time, so there is no injection reason to narrow it.
 */
const personName = (field: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter the client's ${field}`)
    .max(80, `${field[0]!.toUpperCase()}${field.slice(1)} is too long`)
    .refine((value) => /\p{L}/u.test(value), {
      message: `Enter a valid ${field}`,
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

/** Loose on purpose — see the note in validations/onboarding.ts. */
const optionalPhone = z
  .string()
  .trim()
  .max(32)
  .optional()
  .transform((value) => (value === "" ? undefined : value))
  .refine((value) => !value || /^[+0-9][0-9\s().-]{5,}$/.test(value), {
    message: "Enter a valid phone number",
  });

/**
 * Date of birth.
 *
 * Rejects the future and implausibly distant past. Age is deliberately **not**
 * derived and stored: it would be wrong the day after it was written.
 */
const optionalDateOfBirth = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === "" ? undefined : value))
  .refine(
    (value) => {
      if (!value) return true;
      const date = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) return false;

      const now = new Date();
      if (date.getTime() > now.getTime()) return false;

      // 130 years is comfortably beyond any living person and catches typos
      // such as a mistyped century.
      const earliest = new Date(
        Date.UTC(now.getUTCFullYear() - 130, now.getUTCMonth(), now.getUTCDate()),
      );
      return date.getTime() >= earliest.getTime();
    },
    { message: "Enter a valid date of birth" },
  );

const optionalCountry = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === "" ? undefined : value?.toUpperCase()))
  .refine((value) => !value || /^[A-Z]{2}$/.test(value), {
    message: "Select a country",
  });

/**
 * Assignment target.
 *
 * A membership id, or the empty string for "unassigned". Its ownership is
 * verified server-side: a well-formed id from another practice passes this
 * schema and is rejected by the service, which is where the check belongs.
 */
const optionalAssignment = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === "" || value === "unassigned" ? undefined : value))
  .refine((value) => !value || z.uuid().safeParse(value).success, {
    message: "Select a valid team member",
  });

const clientFields = {
  firstName: personName("first name"),
  lastName: personName("last name"),
  email: optionalEmail,
  phone: optionalPhone,
  dateOfBirth: optionalDateOfBirth,
  gender: z
    .enum(CLIENT_GENDERS)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  addressLine: optionalText(200),
  city: optionalText(100),
  state: optionalText(100),
  postalCode: optionalText(20),
  country: optionalCountry,
};

export const createClientSchema = z.object({
  ...clientFields,
  assignedMemberId: optionalAssignment,
});

/** Update carries no assignment: reassignment is a separate, owner-only action. */
export const updateClientSchema = z.object({
  clientId: z.uuid("Invalid client"),
  ...clientFields,
});

export const assignClientSchema = z.object({
  clientId: z.uuid("Invalid client"),
  assignedMemberId: optionalAssignment,
});

export const clientActionSchema = z.object({
  clientId: z.uuid("Invalid client"),
});

export type CreateClientInput = z.output<typeof createClientSchema>;
export type CreateClientValues = z.input<typeof createClientSchema>;
export type UpdateClientInput = z.output<typeof updateClientSchema>;
export type UpdateClientValues = z.input<typeof updateClientSchema>;

/**
 * List query parameters.
 *
 * Parsed from the URL, so every value is untrusted. `page` and `perPage` are
 * clamped rather than rejected — a nonsense page number should show page one,
 * not an error — and `perPage` has a ceiling so a crafted request cannot ask
 * for the entire table.
 */
export const clientListQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
  status: z.enum(["all", "active", "archived"]).catch("active"),
  assigned: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === "" || value === "all" ? undefined : value)),
  page: z.coerce.number().int().min(1).catch(1),
});

export type ClientListQuery = z.output<typeof clientListQuerySchema>;

/** Deliberately modest: large pages are slow and nobody scans 100 rows. */
export const CLIENTS_PER_PAGE = 20;
