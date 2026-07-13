import type { VacancyRequestStatus } from "@/api/types";
import { Badge, type BadgeProps } from "@/components/ui/badge";

const STATUS_VARIANT: Record<VacancyRequestStatus, BadgeProps["variant"]> = {
  DRAFT: "outline",
  SUBMITTED: "default",
  DEAN_APPROVED: "default",
  APPROVED: "success",
  PUBLISHED: "success",
  CLOSED: "outline",
  REJECTED: "destructive",
};

export function StatusBadge({ status }: { status: VacancyRequestStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{status.replace(/_/g, " ")}</Badge>;
}
