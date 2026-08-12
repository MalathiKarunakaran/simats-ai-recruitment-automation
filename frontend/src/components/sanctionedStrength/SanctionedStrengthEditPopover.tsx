import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { createSanctionedStrength, updateSanctionedStrength } from "@/api/sanctionedStrength";
import type { DepartmentDesignationBreakdownRow } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Replaces InlineNumberCell (Phase D's click-to-edit-Approved-only pattern)
// -- a single-field cell couldn't carry effective_from/remarks too, even
// though the backend PATCH (SanctionedStrengthUpdatePayload) has always
// accepted all three fields together, and the breakdown row itself now
// carries effective_from/remarks (both null, same convention as
// sanctioned_strength_id, when this designation has never been sanctioned
// for this department yet). This is a compact per-row "Edit" popover,
// pre-filled from the row, with an explicit Save/Cancel (unlike
// InlineNumberCell's Enter/Escape-only interaction, since there are now 3
// fields to review before committing). Keeps InlineNumberCell's exact
// POST-vs-PATCH branch: `row.sanctioned_strength_id` set -> PATCH,
// otherwise -> POST.

const NON_NEGATIVE_INTEGER = /^\d+$/;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface SanctionedStrengthEditPopoverProps {
  row: DepartmentDesignationBreakdownRow;
  departmentId: string;
  campusId: string;
  /** RBAC gate mirror (canManage on the caller) -- when true, renders the
   * plain approved value with no edit affordance at all, same convention as
   * InlineNumberCell's own readOnly prop. */
  readOnly?: boolean;
}

export function SanctionedStrengthEditPopover({
  row,
  departmentId,
  campusId,
  readOnly = false,
}: SanctionedStrengthEditPopoverProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [approvedStrength, setApprovedStrength] = useState(String(row.approved));
  const [effectiveFrom, setEffectiveFrom] = useState(row.effective_from ?? todayIsoDate());
  const [remarks, setRemarks] = useState(row.remarks ?? "");
  const [error, setError] = useState<string | null>(null);

  const trimmedApproved = approvedStrength.trim();
  const isApprovedValid = NON_NEGATIVE_INTEGER.test(trimmedApproved);

  function invalidateAfterSave() {
    void queryClient.invalidateQueries({ queryKey: ["sanctioned-strength-breakdown", departmentId] });
    void queryClient.invalidateQueries({ queryKey: ["sanctioned-strength-register"] });
  }

  // Re-seeds the draft from the row's current values every time the popover
  // opens -- `row` can have changed since the last open (a re-fetch after
  // another save), so this is a fresh pre-fill, not stale local state.
  function openPopover() {
    setApprovedStrength(String(row.approved));
    setEffectiveFrom(row.effective_from ?? todayIsoDate());
    setRemarks(row.remarks ?? "");
    setError(null);
    setOpen(true);
  }

  function cancel() {
    setOpen(false);
    setError(null);
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createSanctionedStrength({
        campus_id: campusId,
        department_id: departmentId,
        designation_id: row.designation_id,
        approved_strength: Number(trimmedApproved),
        effective_from: effectiveFrom,
        remarks: remarks.trim() || null,
      }),
    onSuccess: () => {
      invalidateAfterSave();
      setOpen(false);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to save"),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateSanctionedStrength(row.sanctioned_strength_id as string, {
        approved_strength: Number(trimmedApproved),
        effective_from: effectiveFrom,
        remarks: remarks.trim() || null,
      }),
    onSuccess: () => {
      invalidateAfterSave();
      setOpen(false);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to save"),
  });

  function save() {
    if (!isApprovedValid || !effectiveFrom) return;
    setError(null);
    if (row.sanctioned_strength_id) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (readOnly) {
    return (
      <span className="tabular-nums" aria-label={`Approved for ${row.designation_name}`}>
        {row.approved}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="tabular-nums" aria-label={`Approved for ${row.designation_name}`}>
        {row.approved}
      </span>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) openPopover();
          else cancel();
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Edit sanctioned strength for ${row.designation_name}`}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`edit-approved-${row.designation_id}`}>Approved</Label>
              <Input
                id={`edit-approved-${row.designation_id}`}
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={approvedStrength}
                disabled={isSaving}
                aria-invalid={trimmedApproved !== "" && !isApprovedValid}
                onChange={(e) => setApprovedStrength(e.target.value)}
              />
              {trimmedApproved !== "" && !isApprovedValid ? (
                <p className="text-xs text-destructive">Enter a whole number, 0 or more.</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`edit-effective-from-${row.designation_id}`}>Effective from</Label>
              <Input
                id={`edit-effective-from-${row.designation_id}`}
                type="date"
                value={effectiveFrom}
                disabled={isSaving}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`edit-remarks-${row.designation_id}`}>Remarks</Label>
              <Input
                id={`edit-remarks-${row.designation_id}`}
                value={remarks}
                disabled={isSaving}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={cancel} disabled={isSaving}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={save}
                disabled={!isApprovedValid || !effectiveFrom || isSaving}
              >
                {isSaving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
