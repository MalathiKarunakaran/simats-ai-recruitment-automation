import type { ApplicationStatus } from "@/api/types";
import { Badge, type BadgeProps } from "@/components/ui/badge";

const SUCCESS_STATUSES = new Set<ApplicationStatus>([
  "EMPLOYEE_CREATED",
  "JOINED",
  "OFFER_ACCEPTED",
  "ONBOARDING_COMPLETE",
]);

function variantFor(status: ApplicationStatus): BadgeProps["variant"] {
  if (status === "REJECTED") return "destructive";
  if (SUCCESS_STATUSES.has(status)) return "success";
  if (status === "APPLIED") return "outline";
  return "default";
}

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return <Badge variant={variantFor(status)}>{status.replace(/_/g, " ")}</Badge>;
}
