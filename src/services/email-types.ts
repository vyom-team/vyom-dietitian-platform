/**
 * Email types shared by the transport and the templates.
 *
 * A separate module so the templates can be imported without pulling in the
 * `server-only` transport.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  /** Plain text. Kept alongside HTML so the message is readable anywhere. */
  text: string;
  html: string;
};

export type EmailResult =
  | { delivered: true; transport: string }
  | { delivered: false; reason: "no-transport" | "failed"; transport: string };
