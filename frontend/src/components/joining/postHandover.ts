import type { ApplicationStatus } from "@/api/types";

// Shared by the HOD review / permanent order sections and their hosts
// (docs/specs/hod-review-and-permanent-order.md). Kept out of the component
// files so Fast Refresh keeps working on them.

// Mirrors joining.py's _HOD_REVIEW_ROLES (record) -- a Campus HOD for their
// own campus (the backend 404s another campus), or the office on their behalf.
export const HOD_REVIEW_ROLES = ["SUPER_ADMIN", "HR_ADMIN", "RECRUITMENT_COORDINATOR", "CAMPUS_HOD"];

// Mirrors joining.py's _PERMANENT_ORDER_ROLES (record / upload).
export const PERMANENT_ORDER_ROLES = ["SUPER_ADMIN", "HR_ADMIN", "RECRUITMENT_COORDINATOR"];

// Handed over or later: the employee exists and the HOD review applies.
export const HOD_REVIEW_STATUSES = new Set<ApplicationStatus>([
  "HANDED_OVER_TO_HOD",
  "HOD_REVIEW_COMPLETE",
  "PERMANENT_ORDER_ISSUED",
]);

/** YYYY-MM-DD -> DD-MM-YYYY, as the registers write it. */
export function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}-${month}-${year}`;
}
