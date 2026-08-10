import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { getSanctionedStrengthHistory } from "@/api/sanctionedStrength";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

// History drawer (zany-snuggling-pie.md Phase D, item 4). No drawer/slide-out
// primitive exists in this codebase (dialog.tsx is a fixed centered modal
// only) -- reuses Dialog/DialogContent with an overridden className for a
// right-side slide-in instead of adding a new Radix dependency (Radix's
// Dialog primitive itself is side-agnostic; only this repo's wrapper
// hardcodes centering). Row rendering styled like ActivityLogPage's
// When/Actor/Action table.
//
// Visible to any staff role (not gated to SANCTIONED_STRENGTH_WRITE_ROLES)
// -- it's read-only, mirroring the backend's own `_staff_only` gate on
// GET .../history (app/api/v1/routers/sanctioned_strength.py).

export interface SanctionedStrengthHistoryDrawerProps {
  sanctionedStrengthId: string;
  designationName: string;
}

function sourceLabel(source: string): string {
  return source === "BULK_UPLOAD" ? "Bulk Upload" : "Manual";
}

export function SanctionedStrengthHistoryDrawer({
  sanctionedStrengthId,
  designationName,
}: SanctionedStrengthHistoryDrawerProps) {
  const [open, setOpen] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["sanctioned-strength-history", sanctionedStrengthId],
    queryFn: () => getSanctionedStrengthHistory(sanctionedStrengthId),
    enabled: open,
  });

  const entries = data?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label={`View history for ${designationName}`}>
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          History
        </Button>
      </DialogTrigger>
      <DialogContent className="fixed inset-y-0 top-0 left-auto right-0 h-full w-96 max-w-full translate-x-0 translate-y-0 rounded-none border-l border-border p-6 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>History: {designationName}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : "Failed to load history."}
          </p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 font-medium">When</th>
                <th className="py-2 font-medium">Change</th>
                <th className="py-2 font-medium">Changed by</th>
                <th className="py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-border last:border-0 align-top">
                  <td className="py-2 whitespace-nowrap">{new Date(entry.changed_at).toLocaleString()}</td>
                  <td className="py-2 tabular-nums">
                    {entry.old_value ?? "—"} → {entry.new_value}
                  </td>
                  <td className="py-2 text-muted-foreground" title={entry.changed_by_id}>
                    {entry.changed_by_id.slice(0, 8)}
                  </td>
                  <td className="py-2 text-muted-foreground">{sourceLabel(entry.source)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}
