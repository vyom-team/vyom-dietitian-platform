"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, UserRoundCog } from "lucide-react";
import { toast } from "sonner";

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
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  archiveClientAction,
  assignClientAction,
  restoreClientAction,
  type ClientActionState,
} from "@/lib/clients/actions";
import type { AssignableMember } from "@/services/clients";

const initialState: ClientActionState = { status: "idle" };

/** Reports an action result once, as a toast. */
function useResultToast(state: ClientActionState, onSuccess?: () => void) {
  const seen = useRef<ClientActionState>(state);

  useEffect(() => {
    if (state === seen.current || state.status === "idle" || !state.message) return;
    seen.current = state;

    if (state.status === "error") {
      toast.error(state.message);
    } else {
      toast.success(state.message);
      onSuccess?.();
    }
  }, [state, onSuccess]);
}

/**
 * Archive, with confirmation.
 *
 * Archiving hides a client from the active list and is easily reversed, but it
 * removes them from everyday view, so it asks first. The dialog states the
 * consequence rather than asking a bare "are you sure?".
 */
export function ArchiveClientButton({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(archiveClientAction, initialState);
  useResultToast(state, () => setOpen(false));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Archive className="size-4" aria-hidden="true" />
          Archive
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Archive {clientName}?</DialogTitle>
          <DialogDescription>
            They will no longer appear in your active client list. Their record
            and history are kept, and you can restore them at any time.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction}>
          <input type="hidden" name="clientId" value={clientId} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton pendingLabel="Archiving…">Archive client</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Restore. No dialog — it is additive and trivially reversible. */
export function RestoreClientButton({ clientId }: { clientId: string }) {
  const [state, formAction] = useActionState(restoreClientAction, initialState);
  useResultToast(state);

  return (
    <form action={formAction}>
      <input type="hidden" name="clientId" value={clientId} />
      <SubmitButton pendingLabel="Restoring…">
        <ArchiveRestore className="size-4" aria-hidden="true" />
        Restore client
      </SubmitButton>
    </form>
  );
}

/**
 * Assign or reassign.
 *
 * The picker lists only staff of this practice who may hold clients. The server
 * re-verifies the chosen membership belongs here and is eligible, and a database
 * trigger rejects a cross-practice assignment outright — so the narrow list is
 * a convenience, not the control.
 */
export function AssignClientDialog({
  clientId,
  currentMemberId,
  members,
}: {
  clientId: string;
  currentMemberId: string | null;
  members: AssignableMember[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(assignClientAction, initialState);
  useResultToast(state, () => setOpen(false));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserRoundCog className="size-4" aria-hidden="true" />
          {currentMemberId ? "Reassign" : "Assign"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign this client</DialogTitle>
          <DialogDescription>
            Choose who is responsible for their care.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-6">
          <input type="hidden" name="clientId" value={clientId} />

          <Field>
            <FieldLabel htmlFor="assignedMemberId">Assigned to</FieldLabel>
            <Select
              name="assignedMemberId"
              defaultValue={currentMemberId ?? "unassigned"}
            >
              <SelectTrigger id="assignedMemberId">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {members.map((member) => (
                  <SelectItem key={member.membershipId} value={member.membershipId}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              Reassigning keeps a record of who was responsible before.
            </FieldDescription>
          </Field>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton pendingLabel="Saving…">Save assignment</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
