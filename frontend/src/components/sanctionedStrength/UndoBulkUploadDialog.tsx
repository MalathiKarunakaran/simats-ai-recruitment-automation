import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { undoSanctionedStrengthBulkUpload } from "@/api/sanctionedStrength";
import type { BulkUploadEntityType, BulkUploadUndoResponse } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

// "Undo last upload" confirm dialog (zany-snuggling-pie.md Phase F).
// Generalized in Phase J (glowing-zooming-hamming.md) to cover Location and
// HousekeepingStaff batches too, via the new required `entityType` prop --
// same Dialog/DialogHeader/DialogTitle/DialogFooter + destructive Button
// shape as Phase D's DeleteSanctionedStrengthDialog, naming the batch being
// reverted. Only ever rendered by UploadHistoryTab for a row it's already
// determined is within the 24h undo window (server still re-checks and
// returns a 409 past the deadline, surfaced inline here same as the delete
// dialog's 409).
//
// The confirm copy genuinely differs by entity type, not just cosmetically:
// Sanctioned Strength's undo can revert a row this batch *updated* back to
// its prior approved_strength (a real SanctionedStrengthHistory.old_value
// exists for every touched row); Location/HousekeepingStaff's undo cannot --
// neither has a permanent old-value history table, so only rows this batch
// *created* can be reverted (see app/models/bulk_upload_row_log.py's own
// docstring for why re-deriving prior values from the stored original file
// doesn't work either). Getting this copy right matters: telling a caller
// their post-upload edits to an updated Location row will "go back to their
// prior value" when they in fact won't would be actively misleading, not
// just imprecise.

const ENTITY_LABELS: Record<BulkUploadEntityType, string> = {
  SANCTIONED_STRENGTH: "sanctioned strength",
  LOCATION: "location",
  HOUSEKEEPING_STAFF: "housekeeping staff",
};

// Which list page's query to refresh once this undo has touched live rows
// for that entity -- mirrors each page's own useQuery queryKey
// (SanctionedStrengthPage's register query, LocationsPage's/
// HousekeepingStaffListPage's own full-list query).
const REFRESH_QUERY_KEY: Record<BulkUploadEntityType, string> = {
  SANCTIONED_STRENGTH: "sanctioned-strength-register",
  LOCATION: "locations",
  HOUSEKEEPING_STAFF: "housekeeping-staff",
};

export interface UndoBulkUploadDialogProps {
  bulkUploadLogId: string;
  filename: string;
  uploadedAt: string;
  entityType: BulkUploadEntityType;
}

export function UndoBulkUploadDialog({
  bulkUploadLogId,
  filename,
  uploadedAt,
  entityType,
}: UndoBulkUploadDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Phase J -- a completed-but-partial undo (some rows skipped, see the
  // module docstring above) sets this instead of closing the dialog, so
  // `not_reverted_count > 0` is never silently swallowed.
  const [result, setResult] = useState<BulkUploadUndoResponse | null>(null);

  const undoMutation = useMutation({
    mutationFn: () => undoSanctionedStrengthBulkUpload(bulkUploadLogId),
    onSuccess: (data) => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["sanctioned-strength-bulk-uploads"] });
      void queryClient.invalidateQueries({ queryKey: [REFRESH_QUERY_KEY[entityType]] });
      if (data.not_reverted_count > 0) {
        setResult(data);
      } else {
        setOpen(false);
      }
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to undo this upload"),
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setError(null);
      setResult(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm" aria-label={`Undo upload ${filename}`}>
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
          Undo
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Undo bulk upload</DialogTitle>
        </DialogHeader>

        {result ? (
          <>
            <p className="text-sm text-muted-foreground">
              {result.reverted_history_count} row(s) reverted. {result.not_reverted_count} row(s) that this batch
              updated (rather than created) could not be automatically reverted and remain unchanged -- see this
              dialog's own description for why.
            </p>
            <DialogFooter>
              {/* "Done", not "Close" -- DialogContent's own built-in X
                  button is already sr-only-labeled "Close" (see
                  components/ui/dialog.tsx), and a second same-named button
                  would be ambiguous for both a11y and `getByRole` queries. */}
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {entityType === "SANCTIONED_STRENGTH" ? (
                <>
                  Revert every {ENTITY_LABELS[entityType]} change made by{" "}
                  <span className="font-medium text-foreground">{filename}</span> (uploaded{" "}
                  {new Date(uploadedAt).toLocaleString()})? Rows this batch updated go back to their prior value;
                  rows this batch created are removed. This only works within 24 hours of the original upload.
                </>
              ) : (
                <>
                  Revert the {ENTITY_LABELS[entityType]} changes made by{" "}
                  <span className="font-medium text-foreground">{filename}</span> (uploaded{" "}
                  {new Date(uploadedAt).toLocaleString()})? Rows this batch created are removed. Rows this batch
                  updated cannot be automatically reverted -- edit them manually if needed. This only works within
                  24 hours of the original upload.
                </>
              )}
            </p>
            {error ? (
              <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button variant="destructive" disabled={undoMutation.isPending} onClick={() => undoMutation.mutate()}>
                {undoMutation.isPending ? "Undoing…" : "Confirm undo"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
