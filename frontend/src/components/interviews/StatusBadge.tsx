import type { InterviewScheduleStatus } from "@/api/types";
import { Badge, type BadgeProps } from "@/components/ui/badge";

// Exported so other interview UI (InterviewsCalendar's day-cell chips) can
// reuse this exact status->color mapping instead of maintaining a second,
// possibly-drifting copy.
export const STATUS_VARIANT: Record<InterviewScheduleStatus, BadgeProps["variant"]> = {
  SCHEDULED: "default",
  COMPLETED: "success",
  CANCELLED: "destructive",
  RESCHEDULED: "outline",
};

export function StatusBadge({ status }: { status: InterviewScheduleStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>;
}
