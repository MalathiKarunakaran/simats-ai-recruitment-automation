import type { InterviewScheduleStatus } from "@/api/types";
import { Badge, type BadgeProps } from "@/components/ui/badge";

const STATUS_VARIANT: Record<InterviewScheduleStatus, BadgeProps["variant"]> = {
  SCHEDULED: "default",
  COMPLETED: "success",
  CANCELLED: "destructive",
  RESCHEDULED: "outline",
};

export function StatusBadge({ status }: { status: InterviewScheduleStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>;
}
