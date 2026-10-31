import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { listCampuses } from "@/api/campuses";
import { createSelectionBatch } from "@/api/selectionBatches";
import type { SelectionBatchDetail, TalentPoolEntryRead } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const NO_CAMPUS = "__none__";

interface SendToUniversityDialogProps {
  entries: TalentPoolEntryRead[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (batch: SelectionBatchDetail) => void;
}

interface PersonDraft {
  designation: string;
  proposedSalary: string;
}

// POST /selection-batches. The server's 409 (already in a live batch, naming
// the batch) and 422 (not Selected / removed) are shown as-is.
export function SendToUniversityDialog({ entries, open, onOpenChange, onCreated }: SendToUniversityDialogProps) {
  const [campusId, setCampusId] = useState(NO_CAMPUS);
  const [note, setNote] = useState("");
  // Keyed by entry id; an untouched person falls back to the prefill.
  const [drafts, setDrafts] = useState<Record<string, PersonDraft>>({});
  const [error, setError] = useState<string | null>(null);

  const campusesQuery = useQuery({ queryKey: ["campuses"], queryFn: listCampuses, enabled: open });

  function draftFor(entry: TalentPoolEntryRead): PersonDraft {
    return drafts[entry.id] ?? { designation: entry.applied_post ?? "", proposedSalary: "" };
  }

  function patch(entry: TalentPoolEntryRead, change: Partial<PersonDraft>) {
    setDrafts((current) => ({ ...current, [entry.id]: { ...draftFor(entry), ...change } }));
  }

  const mutation = useMutation({
    mutationFn: () =>
      createSelectionBatch({
        members: entries.map((entry) => {
          const draft = draftFor(entry);
          return {
            talent_pool_entry_id: entry.id,
            designation: draft.designation.trim() || null,
            proposed_salary: draft.proposedSalary.trim() || null,
          };
        }),
        campus_id: campusId === NO_CAMPUS ? null : campusId,
        note: note.trim() || null,
      }),
    onSuccess: (batch) => {
      setError(null);
      setDrafts({});
      setNote("");
      onCreated(batch);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not create the selection batch"),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) setError(null); onOpenChange(next); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send to University</DialogTitle>
          <DialogDescription>
            {entries.length} {entries.length === 1 ? "person" : "people"} will be listed in a numbered selection batch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="batch-campus">Campus (optional)</Label>
            <Select value={campusId} onValueChange={setCampusId}>
              <SelectTrigger id="batch-campus" aria-label="Campus">
                <SelectValue placeholder="No campus" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CAMPUS}>No campus</SelectItem>
                {(campusesQuery.data ?? []).map((campus) => (
                  <SelectItem key={campus.id} value={campus.id}>{campus.code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="batch-note">Note (optional)</Label>
            <Textarea id="batch-note" value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={2000} />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">People</p>
            <ul className="space-y-2">
              {entries.map((entry) => {
                const draft = draftFor(entry);
                return (
                  <li key={entry.id} className="rounded-md border border-border p-2">
                    <p className="text-sm font-medium">{entry.full_name}</p>
                    <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Input
                        value={draft.designation}
                        onChange={(event) => patch(entry, { designation: event.target.value })}
                        placeholder="Designation"
                        aria-label={`Designation for ${entry.full_name}`}
                        maxLength={255}
                        className="h-8 text-xs"
                      />
                      <Input
                        value={draft.proposedSalary}
                        onChange={(event) => patch(entry, { proposedSalary: event.target.value })}
                        placeholder="Proposed salary"
                        aria-label={`Proposed salary for ${entry.full_name}`}
                        maxLength={100}
                        className="h-8 text-xs"
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || entries.length === 0}>
            {mutation.isPending ? "Sending…" : "Send to University"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
