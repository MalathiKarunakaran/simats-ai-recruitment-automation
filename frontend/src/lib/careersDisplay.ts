import type { StaffRoleCategory } from "@/api/types";

// Display helpers shared by the public careers pages (2026-09-07).

/** Human labels for the three staff categories, for a candidate audience. */
export const CATEGORY_LABELS: Record<StaffRoleCategory, string> = {
  TEACHING: "Teaching",
  NON_TEACHING: "Non-Teaching",
  HOUSEKEEPING: "Housekeeping",
};

/** "FULL_TIME" -> "Full Time". */
export function formatEmploymentType(value: string): string {
  return value.replace(/_/g, " ").toLowerCase().replace(/(^|\s)([a-z])/g, (m) => m.toUpperCase());
}

/** A date-only ISO string ("2026-09-30") rendered in the viewer's locale.
 * Parsed as local time on purpose: `new Date("2026-09-30")` is UTC midnight,
 * which in IST is fine but west of Greenwich shows the previous day. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
