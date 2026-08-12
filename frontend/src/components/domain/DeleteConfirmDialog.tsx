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
  /** Accessible name for the trigger button, e.g. "Delete campus SSE". */
  triggerAriaLabel: string;
  title: string;
  description: ReactNode;
  onDelete: () => Promise<unknown>;
  /** Called after a successful delete -- typically query invalidation. */
  onDeleted: () => void;
  disabled?: boolean;
}

export function DeleteConfirmDialog({
  triggerAriaLabel,
  title,
  description,
  onDelete,
  onDeleted,
  disabled,
}: DeleteConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: onDelete,
    onSuccess: () => {
      setOpen(false);
      setError(null);
      onDeleted();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to delete"),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm" aria-label={triggerAriaLabel} disabled={disabled}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </DialogTrigger>
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
