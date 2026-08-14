import type { OrganizationRole } from "@/generated/prisma/enums";

/**
 * Client rules that are pure functions of their inputs.
 *
 * Deliberately free of `server-only`: no I/O, no database, no secrets. Keeping
 * them out of the service module means the visibility rule and the client-number
 * format can be unit-tested directly, which matters because the visibility rule
 * is a security boundary.
 */

const CLIENT_NUMBER_PREFIX = "VYM";
const CLIENT_NUMBER_DIGITS = 6;

/**
 * Formats a sequence number as a human-readable client identifier.
 *
 * Zero-padded so identifiers sort naturally and are easy to read aloud —
 * "open client VYM-000124".
 */
export function formatClientNumber(sequence: number): string {
  return `${CLIENT_NUMBER_PREFIX}-${String(sequence).padStart(CLIENT_NUMBER_DIGITS, "0")}`;
}

/**
 * Whether a role sees the whole practice or only its own caseload.
 *
 * Owners administer the practice and receptionists handle scheduling and
 * intake, so both need the full list. A dietitian sees the clients they are
 * responsible for — the smallest set that lets them do their work.
 *
 * A CLIENT-role member gets nothing here; `requireClientContext` rejects them
 * before this is reached, but returning false keeps the rule correct on its own.
 */
export function seesAllClients(role: OrganizationRole): boolean {
  return role === "OWNER" || role === "RECEPTIONIST" || role === "SUPER_ADMIN";
}
