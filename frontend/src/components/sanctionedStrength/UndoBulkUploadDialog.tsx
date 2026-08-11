import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { undoSanctionedStrengthBulkUpload } from "@/api/sanctionedStrength";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

// "Undo last upload" confirm dialog (zany-snuggling-pie.md Phase F) -- same
// Dialog/DialogHeader/DialogTitle/DialogFooter + destructive Button shape as
// Phase D's DeleteSanctionedStrengthDialog, naming the batch being reverted.
// Only ever rendered by UploadHistoryTab for a row it's already determined
// is within the 24h undo window (server still re-checks and returns a 409
// past the deadline, surfaced inline here same as the delete dialog's 409).

export interface UndoBulkUploadDialogProps {
  bulkUploadLogId: string;
  filename: string;
  uploadedAt: string;
}

export function UndoBulkUploadDialog({ bulkUploadLogId, filename, uploadedAt }: UndoBulkUploadDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const undoMutation = useMutation({
    mutationFn: () => undoSanctionedStrengthBulkUpload(bulkUploadLogId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sanctioned-strength-bulk-uploads"] });
      void queryClient.invalidateQueries({ queryKey: ["sanctioned-strength-register"] });
      setOpen(false);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to undo this upload"),
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
        <Button type="button" variant="destructive" size="sm" aria-label={`Undo upload ${filename}`}>
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
          Undo
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Undo bulk upload</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Revert every sanctioned strength change made by <span className="font-medium text-foreground">{filename}</span>{" "}
          (uploaded {new Date(uploadedAt).toLocaleString()})? Rows this batch updated go back to their prior value;
          rows this batch created are removed. This only works within 24 hours of the original upload.
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
      </DialogContent>
    </Dialog>
  );
}
