import type { EmploymentStatus } from "@/api/types";
import { Badge, type BadgeProps } from "@/components/ui/badge";

const STATUS_VARIANT: Record<EmploymentStatus, BadgeProps["variant"]> = {
  ACTIVE: "success",
  RESIGNED: "outline",
  RETIRED: "outline",
  TERMINATED: "destructive",
};

export function StatusBadge({ status }: { status: EmploymentStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>;
}
