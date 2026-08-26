import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { StaffRoleCategory } from "@/api/types";

// Departments page follow-up spec: color-code the Category column instead of
// plain text. Reuses this app's existing Badge variants -- no new color
// tokens needed: TEACHING -> info (blue), NON_TEACHING -> outline (renders
// in brand-plum/purple), HOUSEKEEPING -> warning (orange).
const CATEGORY_BADGE_VARIANT: Record<StaffRoleCategory, NonNullable<BadgeProps["variant"]>> = {
  TEACHING: "info",
  NON_TEACHING: "outline",
  HOUSEKEEPING: "warning",
};

export function CategoryBadge({ category }: { category: StaffRoleCategory }) {
  return <Badge variant={CATEGORY_BADGE_VARIANT[category]}>{category.replace(/_/g, " ")}</Badge>;
}
