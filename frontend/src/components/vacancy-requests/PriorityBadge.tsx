import type { VacancyPriority } from "@/api/types";
import { Badge, type BadgeProps } from "@/components/ui/badge";

// Deliberately subtler than StatusBadge -- Status is this table's primary
// signal, Priority is secondary context, so LOW/NORMAL both map to the
// quietest variants and only HIGH/URGENT escalate visually. Same
// Record<..., BadgeProps["variant"]> shape as StatusBadge.tsx for
// consistency between the two badge components on this page.
const PRIORITY_VARIANT: Record<VacancyPriority, BadgeProps["variant"]> = {
  LOW: "outline",
  NORMAL: "default",
  HIGH: "warning",
  URGENT: "destructive",
};

export function PriorityBadge({ priority }: { priority: VacancyPriority }) {
  return <Badge variant={PRIORITY_VARIANT[priority]}>{priority}</Badge>;
}
