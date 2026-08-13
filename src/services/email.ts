import "server-only";

/**
 * Transactional email.
 *
 * No provider is configured yet — Resend belongs to a later phase — so this is
 * an abstraction with a **development transport that logs instead of sending**.
 *
 * It is deliberately not a fake success. `send()` reports `delivered: false`
 * with reason `no-transport`, and callers surface that honestly: the team page
 * shows the invitation link for the owner to share directly rather than
 * claiming an email went out that never did. A silent no-op here would be worse
 * than no email at all, because nobody would know the invitation was undelivered.
 *
 * Wiring a real provider means implementing one more transport and selecting it
 * from configuration. Nothing above this interface changes.
 *
 * Note: this is application email. Supabase Auth sends its own verification and
 * password-reset messages through a separate path — see docs/authentication.md.
 */

import type { EmailMessage, EmailResult } from "@/services/email-types";

export type { EmailMessage, EmailResult };

/**
 * Development transport.
 *
 * Logs the subject and recipient. The body is **not** logged: an invitation
 * body contains a live token, and tokens must not end up in log aggregation.
 */
const devTransport = {
  name: "development-log",
  async send(message: EmailMessage): Promise<EmailResult> {
    console.info(
      `[email:${devTransport.name}] would send "${message.subject}" to ${message.to} ` +
        "(no provider configured; body withheld because it contains a token)",
    );
    return { delivered: false, reason: "no-transport", transport: devTransport.name };
  },
};

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  // Provider selection lands here when one is configured.
  return devTransport.send(message);
}

/** Whether a real provider is wired up. Lets callers set expectations honestly. */
export function isEmailDeliveryConfigured(): boolean {
  return false;
}

export { buildInvitationEmail } from "@/services/email-templates";
