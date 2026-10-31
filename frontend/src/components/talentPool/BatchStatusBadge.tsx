import type { SelectionBatchStatus } from "@/api/types";
import { Badge } from "@/components/ui/badge";

const LABELS: Record<SelectionBatchStatus, string> = {
  SENT_TO_UNIVERSITY: "Sent to University",
  UNIVERSITY_APPROVED: "University approved",
  WITHDRAWN: "Withdrawn",
};

const VARIANTS: Record<SelectionBatchStatus, "info" | "success" | "default"> = {
  SENT_TO_UNIVERSITY: "info",
  UNIVERSITY_APPROVED: "success",
  WITHDRAWN: "default",
};

export function BatchStatusBadge({ status }: { status: SelectionBatchStatus }) {
  return <Badge variant={VARIANTS[status]}>{LABELS[status] ?? status}</Badge>;
}

export const BATCH_STATUS_LABELS = LABELS;
