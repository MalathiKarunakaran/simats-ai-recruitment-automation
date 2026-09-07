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

/** A date-only ISO string ("2026-09-30") as "30 Sept 2026".
 *
 * Pinned to en-IN rather than the viewer's locale: the audience is Indian
 * and the day-month-year order is what a printed ad uses -- and CI's en-US
 * default rendered "Sep 30, 2026", which failed the tests that read the
 * page as a candidate would. Parsed as local time on purpose: `new
 * Date("2026-09-30")` is UTC midnight, which west of Greenwich shows the
 * previous day. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
