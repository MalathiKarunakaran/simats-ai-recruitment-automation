import type { ApplicationStatus } from "@/api/types";
import { Badge, type BadgeProps } from "@/components/ui/badge";

const SUCCESS_STATUSES = new Set<ApplicationStatus>([
  "HANDED_OVER_TO_HOD",
  "JOINED",
  "OFFER_ACCEPTED",
  "DEPARTMENT_ROOM_ALLOTTED",
  "ORIENTATION_COMPLETE",
]);

function variantFor(status: ApplicationStatus): BadgeProps["variant"] {
  if (status === "REJECTED") return "destructive";
  if (status === "WITHDRAWN") return "warning";
  if (SUCCESS_STATUSES.has(status)) return "success";
  if (status === "APPLIED") return "outline";
  return "default";
}

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return <Badge variant={variantFor(status)}>{status.replace(/_/g, " ")}</Badge>;
}
