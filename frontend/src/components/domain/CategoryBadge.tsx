import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { StaffRoleCategory } from "@/api/types";

// Departments page follow-up spec: color-code the Category column instead of
// plain text. Reuses this app's existing Badge variants -- no new color
// tokens needed: TEACHING -> info (blue), NON_TEACHING -> outline (renders
// in brand-plum/purple), HOUSEKEEPING -> warning (orange).
//
// Moved from components/departments/ to components/domain/ (Designation
// Master production-hardening epic, frontend Phase 2) -- this component
// takes a plain `StaffRoleCategory` and has zero department-specific logic,
// so it's genuinely shared between DepartmentsPage and DesignationsPage
// (both of which have a Category column). components/domain/ is this
// repo's existing home for cross-entity shared feature components
// (CategoryTabs, DeleteConfirmDialog already live there) -- not
// components/common/, which doesn't exist in this codebase.
const CATEGORY_BADGE_VARIANT: Record<StaffRoleCategory, NonNullable<BadgeProps["variant"]>> = {
  TEACHING: "info",
  NON_TEACHING: "outline",
  HOUSEKEEPING: "warning",
};

export function CategoryBadge({ category }: { category: StaffRoleCategory }) {
  return <Badge variant={CATEGORY_BADGE_VARIANT[category]}>{category.replace(/_/g, " ")}</Badge>;
}
