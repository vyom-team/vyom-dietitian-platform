"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Check, Copy, UserPlus } from "lucide-react";

import { SubmitButton } from "@/components/auth/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { inviteMemberAction, type TeamActionState } from "@/lib/team/actions";
import {
  INVITABLE_ROLES,
  INVITABLE_ROLE_DESCRIPTIONS,
  INVITABLE_ROLE_LABELS,
} from "@/validations/team";
import { cn } from "@/lib/utils";

const initialState: TeamActionState = { status: "idle" };

/**
 * Invite a team member.
 *
 * Role is a radio group of exactly the two invitable roles. Owner and platform
 * admin are not rendered — and, more importantly, are rejected by the schema on
 * the server, so their absence here is a usability choice rather than the
 * security control.
 */
export function InviteDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(inviteMemberAction, initialState);
  const [copied, setCopied] = useState(false);

  /*
   * The dialog does not close itself on success. It shows a confirmation the
   * owner dismisses — which is necessary when the invitation link has to be
   * copied manually, and clearer than a dialog that vanishes even when it does
   * not. Deriving this from render state also avoids syncing state in an effect.
   */
  const succeeded = state.status === "success";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setCopied(false);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="size-4" aria-hidden="true" />
          Invite member
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>
            They&apos;ll get a link to join your practice. It expires in 7 days.
          </DialogDescription>
        </DialogHeader>

        {succeeded ? (
          <InviteLinkPanel
            message={state.message}
            url={state.inviteUrl}
            copied={copied}
            onCopy={async () => {
              if (!state.inviteUrl) return;
              await navigator.clipboard.writeText(state.inviteUrl);
              setCopied(true);
            }}
            onDone={() => setOpen(false)}
          />
        ) : (
          <form action={formAction}>
            <FieldGroup>
              {state.status === "error" && state.message ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive-subtle p-3 text-sm text-destructive"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <p className="text-pretty">{state.message}</p>
                </div>
              ) : null}

              <Field>
                <FieldLabel htmlFor="invite-email">Email address</FieldLabel>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="off"
                  placeholder="colleague@practice.com"
                  aria-invalid={state.fieldErrors?.email ? true : undefined}
                  aria-describedby={
                    state.fieldErrors?.email ? "invite-email-error" : undefined
                  }
                />
                {state.fieldErrors?.email ? (
                  <p id="invite-email-error" className="text-sm text-destructive">
                    {state.fieldErrors.email}
                  </p>
                ) : null}
              </Field>

              <Field>
                <FieldLabel htmlFor="invite-role">Role</FieldLabel>
                <RadioGroup
                  name="role"
                  defaultValue="DIETITIAN"
                  aria-label="Role"
                  className="gap-2"
                >
                  {INVITABLE_ROLES.map((role) => (
                    <label
                      key={role}
                      htmlFor={`role-${role}`}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                        "hover:bg-muted/50 has-[:checked]:border-primary/40 has-[:checked]:bg-accent",
                      )}
                    >
                      <RadioGroupItem
                        id={`role-${role}`}
                        value={role}
                        className="mt-0.5"
                      />
                      <span className="space-y-0.5">
                        <span className="block text-sm font-medium">
                          {INVITABLE_ROLE_LABELS[role]}
                        </span>
                        <span className="type-caption block">
                          {INVITABLE_ROLE_DESCRIPTIONS[role]}
                        </span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              </Field>

              <Field>
                <FieldLabel htmlFor="invite-message">
                  Personal message
                </FieldLabel>
                <Textarea
                  id="invite-message"
                  name="message"
                  rows={3}
                  placeholder="Optional note to include in the invitation."
                  aria-describedby="invite-message-hint"
                />
                <FieldDescription id="invite-message-hint">
                  Optional.
                </FieldDescription>
              </Field>
            </FieldGroup>

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <SubmitButton pendingLabel="Sending invitation…">
                Send invitation
              </SubmitButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Shown when the invitation was created but no mail provider is configured.
 *
 * The owner gets the link to share directly rather than a false "sent"
 * confirmation.
 */
function InviteLinkPanel({
  message,
  url,
  copied,
  onCopy,
  onDone,
}: {
  message?: string;
  /** Present only when email delivery is unavailable. */
  url?: string;
  copied: boolean;
  onCopy: () => void;
  onDone: () => void;
}) {
  return (
    <div className="space-y-4">
      <div
        role="status"
        className="rounded-md border border-success/20 bg-success-subtle p-3 text-sm text-success"
      >
        <p className="text-pretty">{message}</p>
      </div>

      {url ? (
      <div className="space-y-2">
        <p className="type-label">Invitation link</p>
        <div className="flex items-center gap-2">
          <Input readOnly value={url} className="font-mono text-xs" />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onCopy}
            aria-label={copied ? "Link copied" : "Copy invitation link"}
          >
            {copied ? (
              <Check className="size-4 text-success" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
          </Button>
        </div>
        <p className="type-caption">
          Anyone with this link and the invited email address can join. Share it
          privately.
        </p>
      </div>
      ) : null}

      <DialogFooter>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}
