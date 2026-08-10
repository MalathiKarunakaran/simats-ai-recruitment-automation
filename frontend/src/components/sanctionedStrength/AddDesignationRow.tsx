import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { listDesignations } from "@/api/designations";
import { createSanctionedStrength } from "@/api/sanctionedStrength";
import type { StaffRoleCategory } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// "Add designation" (zany-snuggling-pie.md Phase D, item 2) -- a trailing
// row under an expanded department's breakdown table. Only offers
// designations whose category matches the department's own category
// (blocked client-side via the Select's contents; the backend's own 400 on
// a category mismatch is still the real enforcement, surfaced below if
// ever reached) and not already shown as a breakdown row for this
// department (avoids inviting an exact duplicate key).

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface AddDesignationRowProps {
  departmentId: string;
  campusId: string;
  category: StaffRoleCategory | null;
  /** designation_ids already present in this department's breakdown --
   * offering one of these again would just invite a duplicate-key 409/400
   * from the backend for no benefit (see InlineNumberCell for editing an
   * already-present, still-unsanctioned row instead). */
  excludeDesignationIds: string[];
  columnCount: number;
}

export function AddDesignationRow({
  departmentId,
  campusId,
  category,
  excludeDesignationIds,
  columnCount,
}: AddDesignationRowProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [designationId, setDesignationId] = useState<string>("");
  const [approvedStrength, setApprovedStrength] = useState("0");
  const [effectiveFrom, setEffectiveFrom] = useState(todayIsoDate());
  const [error, setError] = useState<string | null>(null);

  const { data: designations } = useQuery({
    queryKey: ["designations"],
    queryFn: () => listDesignations(),
    enabled: open,
  });

  const excluded = new Set(excludeDesignationIds);
  const candidateDesignations = (designations ?? []).filter(
    (designation) => designation.category === category && !excluded.has(designation.id),
  );

  const strengthValid = /^\d+$/.test(approvedStrength.trim());

  function resetAndClose() {
    setOpen(false);
    setDesignationId("");
    setApprovedStrength("0");
    setEffectiveFrom(todayIsoDate());
    setError(null);
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createSanctionedStrength({
        campus_id: campusId,
        department_id: departmentId,
        designation_id: designationId,
        approved_strength: Number(approvedStrength.trim()),
        effective_from: effectiveFrom,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sanctioned-strength-breakdown", departmentId] });
      void queryClient.invalidateQueries({ queryKey: ["sanctioned-strength-register"] });
      resetAndClose();
    },
    // Surfaces the backend's exact message (e.g. item 6's category-mismatch
    // 400) rather than a generic failure -- shouldn't be reachable given the
    // Select is already category-filtered, but the backend re-checks
    // defensively and this is what shows if it ever disagrees.
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to add designation"),
  });

  function submit() {
    if (!designationId || !strengthValid || !effectiveFrom) return;
    setError(null);
    createMutation.mutate();
  }

  if (!open) {
    return (
      <tr>
        <td colSpan={columnCount} className="px-3 py-1.5">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add designation
          </Button>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={columnCount} className="px-3 py-2">
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3">
          <div className="flex min-w-48 flex-col gap-1">
            <Label htmlFor="new-designation-select">Designation</Label>
            <Select value={designationId} onValueChange={setDesignationId}>
              <SelectTrigger id="new-designation-select" aria-label="Designation">
                <SelectValue placeholder="Select a designation" />
              </SelectTrigger>
              <SelectContent>
                {candidateDesignations.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    No eligible designations to add.
                  </div>
                ) : (
                  candidateDesignations.map((designation) => (
                    <SelectItem key={designation.id} value={designation.id}>
                      {designation.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-28 flex-col gap-1">
            <Label htmlFor="new-designation-approved">Approved</Label>
            <Input
              id="new-designation-approved"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={approvedStrength}
              aria-invalid={approvedStrength.trim() !== "" && !strengthValid}
              onChange={(e) => setApprovedStrength(e.target.value)}
            />
          </div>
          <div className="flex w-40 flex-col gap-1">
            <Label htmlFor="new-designation-effective-from">Effective from</Label>
            <Input
              id="new-designation-effective-from"
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1.5 pb-0.5">
            <Button
              type="button"
              size="sm"
              disabled={!designationId || !strengthValid || !effectiveFrom || createMutation.isPending}
              onClick={submit}
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {createMutation.isPending ? "Adding…" : "Add"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={resetAndClose} disabled={createMutation.isPending}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Cancel
            </Button>
          </div>
        </div>
        {!strengthValid && approvedStrength.trim() !== "" ? (
          <p className="mt-1 text-xs text-destructive">Approved must be a whole number, 0 or more.</p>
        ) : null}
        {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      </td>
    </tr>
  );
}
