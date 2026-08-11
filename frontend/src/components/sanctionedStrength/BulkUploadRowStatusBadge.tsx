import type { BulkUploadRowStatus } from "@/api/types";
import { Badge } from "@/components/ui/badge";

// Shared between BulkUploadDialog's preview table and any future consumer of
// the same row-status vocabulary -- created/updated/unchanged/rejected
// (app/schemas/sanctioned_strength_import.py::BulkUploadRowStatus), a
// distinct vocabulary from TrackerImportPage's
// imported/imported_with_warning/flagged (this flow is a two-step
// validate-then-commit UPSERT preview, not a one-shot import).

const LABELS: Record<BulkUploadRowStatus, string> = {
  created: "Created",
  updated: "Updated",
  unchanged: "Unchanged",
  rejected: "Rejected",
};

export function BulkUploadRowStatusBadge({ status }: { status: BulkUploadRowStatus }) {
  if (status === "rejected") return <Badge variant="destructive">{LABELS[status]}</Badge>;
  if (status === "created") return <Badge variant="success">{LABELS[status]}</Badge>;
  if (status === "updated") return <Badge variant="info">{LABELS[status]}</Badge>;
  return <Badge variant="default">{LABELS[status]}</Badge>;
}
