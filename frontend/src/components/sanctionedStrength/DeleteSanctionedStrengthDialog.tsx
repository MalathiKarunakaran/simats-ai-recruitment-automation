import { useQueryClient } from "@tanstack/react-query";

import { deleteSanctionedStrength } from "@/api/sanctionedStrength";
import { DeleteConfirmDialog } from "@/components/domain/DeleteConfirmDialog";

// Soft-delete confirm dialog (zany-snuggling-pie.md Phase D, item 3).
//
// **Bug found and fixed (2026-08-17, live report)**: this dialog's own
// built-in invalidation (`sanctioned-strength-breakdown`/
// `sanctioned-strength-register`) is exactly right for its original caller,
// SanctionedStrengthPage.tsx's legacy department-rollup `DesignationRow`,
// which renders from those two query keys. But Teaching/Non-Teaching's own
// *dedicated* views (Phases E/F, added after this dialog already existed)
// render from a different pair of query keys entirely
// (`teaching-strength-view`/`non-teaching-strength-view`,
// TeachingStrengthTable.tsx/NonTeachingStrengthTable.tsx) that this dialog
// never knew about -- so a delete from either of those tables succeeded
// server-side (confirmed live: real 204, real soft-delete) but the row kept
// showing until something unrelated happened to refetch, reading to a user
// as "the Delete button does nothing." Fixed with an optional `onDeleted`
// callback, called *in addition to* (not instead of) this dialog's own
// built-in invalidation -- the legacy rollup caller doesn't pass one and
// keeps working exactly as before; StrengthRowActions (TeachingStrengthTable.tsx)
// now passes its own already-existing `onSaved` prop through to this, the
// same view-scoped invalidation callback it already threads to
// SanctionedStrengthDrawer for the Edit path -- Delete was simply the one
// path that never received it.
//
// **Sanctioned-strength-polish (Step 4) reconciliation, 2026-08-22**: this
// used to be a fully separate hand-rolled Dialog/DialogHeader/DialogTitle/
// DialogFooter implementation, deliberately kept apart from the generic
// `components/domain/DeleteConfirmDialog` because of "entity-specific
// messaging + query-invalidation wiring." Re-checked at this step: the
// generic dialog already parameterizes both of those (`title`/`description`
// props for messaging, a required `onDeleted` callback for invalidation --
// see its own docstring), so there was no real remaining reason to hand-roll
// a second Dialog/DialogFooter/error-banner implementation. This is now a
// thin wrapper around the generic dialog: same trigger aria-label, same
// title/body copy, same error rendering (verbatim, since DeleteConfirmDialog
// already renders the backend's message the identical way), and the exact
// same invalidation + onDeleted sequencing as before, just expressed as the
// generic dialog's own `onDeleted` callback instead of a bespoke
// useMutation's onSuccess. The stale-cache bug fix above is untouched --
// `onDeleted` (this component's own optional prop) is still called
// *in addition to* the unconditional breakdown/register invalidation below,
// exactly as before.

export interface DeleteSanctionedStrengthDialogProps {
  sanctionedStrengthId: string;
  designationName: string;
  departmentId: string;
  /** Optional -- lets a caller with its own view-scoped query key (e.g.
   * StrengthRowActions' `teaching-strength-view`/`non-teaching-strength-view`)
   * refetch after a successful delete, on top of this dialog's own built-in
   * breakdown/register invalidation. The legacy rollup-table caller
   * (SanctionedStrengthPage.tsx's DesignationRow) omits this since its own
   * data already comes from the breakdown/register queries this dialog
   * already invalidates unconditionally. */
  onDeleted?: () => void;
}

export function DeleteSanctionedStrengthDialog({
  sanctionedStrengthId,
  designationName,
  departmentId,
  onDeleted,
}: DeleteSanctionedStrengthDialogProps) {
  const queryClient = useQueryClient();

  return (
    <DeleteConfirmDialog
      triggerAriaLabel={`Delete sanctioned strength for ${designationName}`}
      title="Delete sanctioned strength"
      description={
        <>
          Remove the sanctioned strength record for{" "}
          <span className="font-medium text-foreground">{designationName}</span>? This is a soft delete -- it can
          be re-added later, but the current ceiling is removed immediately.
        </>
      }
      onDelete={() => deleteSanctionedStrength(sanctionedStrengthId)}
      onDeleted={() => {
        void queryClient.invalidateQueries({ queryKey: ["sanctioned-strength-breakdown", departmentId] });
        void queryClient.invalidateQueries({ queryKey: ["sanctioned-strength-register"] });
        onDeleted?.();
      }}
    />
  );
}
