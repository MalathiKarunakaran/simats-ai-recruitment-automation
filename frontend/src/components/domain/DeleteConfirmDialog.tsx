import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

// Generic soft-delete confirm dialog, shaped after
// components/sanctionedStrength/DeleteSanctionedStrengthDialog.tsx (same
// Dialog/DialogHeader/DialogTitle/DialogFooter + destructive Button, no
// reason-gate). Shared across the master-data pages (Campuses, Departments,
// Designations, Eligibility Rules) that each got a hard-delete-endpoint-that's-
// actually-a-soft-delete in the same PR -- every one of them surfaces the
// backend's 409 "N active X(s) reference this Y, cannot delete" detail
// message verbatim inline in the dialog body, never a generic conflict copy.

export interface DeleteConfirmDialogProps {
  /** Accessible name for the default trigger button, e.g. "Delete campus
   * SSE". Unused in fully-controlled mode (see `open`/`onOpenChange` below). */
  triggerAriaLabel: string;
  title: string;
  description: ReactNode;
  onDelete: () => Promise<unknown>;
  /** Called after a successful delete -- typically query invalidation. */
  onDeleted: () => void;
  disabled?: boolean;
  /** Custom trigger element (e.g. a ghost "Delete" row-action button)
   * replacing the default destructive icon-only Button -- only meaningful in
   * the default uncontrolled mode. Composes cleanly with a caller's own
   * onClick, same pattern this codebase already relies on for "New X"
   * buttons that both open a dialog and reset local state. NOT safe to use
   * for a trigger living inside something that unmounts on click (e.g. a
   * Popover menu item that closes the popover) -- unmounting this whole
   * component along with its parent destroys the Dialog's own open state
   * before it can render. Use fully-controlled mode (`open`/`onOpenChange`,
   * omit `trigger`) instead for that case -- see DepartmentsPage's
   * `DepartmentRowActions` for the real example this was added for. */
  trigger?: ReactNode;
  /** Fully-controlled mode: the caller owns open/close state and this
   * component renders no trigger of its own (the caller renders its own
   * button anywhere it likes, including inside something that unmounts,
   * since this Dialog itself is a sibling elsewhere and unaffected). Provide
   * both or neither -- provide neither for the default uncontrolled,
   * self-triggering behavior. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function DeleteConfirmDialog({
  triggerAriaLabel,
  title,
  description,
  onDelete,
  onDeleted,
  disabled,
  trigger,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: DeleteConfirmDialogProps) {
  const [openState, setOpenState] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : openState;
  const [error, setError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: onDelete,
    onSuccess: () => {
      if (!isControlled) setOpenState(false);
      onOpenChangeProp?.(false);
      setError(null);
      onDeleted();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to delete"),
  });

  function handleOpenChange(next: boolean) {
    if (!isControlled) setOpenState(next);
    onOpenChangeProp?.(next);
    if (!next) setError(null);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {isControlled ? null : (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button type="button" variant="destructive" size="sm" aria-label={triggerAriaLabel} disabled={disabled}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground">{description}</div>
        {error ? (
          <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
            {deleteMutation.isPending ? "Deleting…" : "Confirm delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
