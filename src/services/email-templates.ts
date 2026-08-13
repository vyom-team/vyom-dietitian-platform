/**
 * Email templates.
 *
 * Deliberately free of `server-only`: these are pure functions that turn data
 * into a message, with no I/O and no secrets. Keeping them separate from the
 * transport in `email.ts` means the copy and the HTML escaping can be
 * unit-tested directly.
 */

import type { EmailMessage } from "@/services/email-types";

/**
 * Invitation email.
 *
 * Contains no client or health information — only the practice name, the role,
 * the expiry, and the link.
 */
export function buildInvitationEmail(params: {
  to: string;
  practiceName: string;
  roleLabel: string;
  inviterName: string;
  acceptUrl: string;
  expiresAt: Date;
  message?: string;
}): EmailMessage {
  const expiry = params.expiresAt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const note = params.message
    ? `\n\n${params.inviterName} added a note:\n"${params.message}"\n`
    : "\n";

  const text = [
    `You've been invited to join ${params.practiceName} on Vyom.`,
    "",
    `Role: ${params.roleLabel}`,
    `Invited by: ${params.inviterName}`,
    note.trim(),
    "",
    "Accept your invitation:",
    params.acceptUrl,
    "",
    `This invitation expires on ${expiry}.`,
    "",
    "If you weren't expecting this invitation, you can ignore this email.",
  ].join("\n");

  const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1a2224">
  <p style="font-size:18px;font-weight:600;margin:0 0 24px">Vyom</p>
  <p style="font-size:16px;line-height:1.6;margin:0 0 8px">
    You've been invited to join <strong>${escapeHtml(params.practiceName)}</strong>.
  </p>
  <p style="font-size:14px;color:#5b6b6e;line-height:1.6;margin:0 0 24px">
    Role: ${escapeHtml(params.roleLabel)}<br>
    Invited by: ${escapeHtml(params.inviterName)}
  </p>
  ${
    params.message
      ? `<blockquote style="margin:0 0 24px;padding:12px 16px;border-left:3px solid #d7dedf;color:#5b6b6e;font-size:14px;line-height:1.6">${escapeHtml(params.message)}</blockquote>`
      : ""
  }
  <p style="margin:0 0 24px">
    <a href="${escapeHtml(params.acceptUrl)}"
       style="display:inline-block;background:#0f6b6b;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:500">
      Accept invitation
    </a>
  </p>
  <p style="font-size:13px;color:#5b6b6e;line-height:1.6;margin:0 0 8px">
    This invitation expires on ${escapeHtml(expiry)}.
  </p>
  <p style="font-size:13px;color:#5b6b6e;line-height:1.6;margin:0">
    If you weren't expecting this invitation, you can ignore this email.
  </p>
</div>`.trim();

  return {
    to: params.to,
    subject: `You've been invited to join ${params.practiceName} on Vyom`,
    text,
    html,
  };
}

/** Minimal HTML escaping for values interpolated into the email body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
