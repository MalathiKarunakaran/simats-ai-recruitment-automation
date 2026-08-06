import type { VacancyRequestStatus } from "@/api/types";

export interface VacancyRequestStatusBuckets {
  total: number;
  draft: number;
  /** SUBMITTED + DEAN_APPROVED -- awaiting the next actor in the chain. */
  pending: number;
  /** HR-approved, not yet published (a real, separate lifecycle moment from
   * "published" -- see the recruitment_officer/reporting.py distinction). */
  approved: number;
  published: number;
  closed: number;
  rejected: number;
  cancelled: number;
}

const PENDING_STATUSES: VacancyRequestStatus[] = ["SUBMITTED", "DEAN_APPROVED"];

/**
 * Single source of truth for every status-bucket count shown anywhere on the
 * Vacancy Requests screen -- the top KPI strip, department summary cards,
 * and the grouped accordion below used to each compute their own counts
 * independently, with silently-diverging definitions of "approved" (one
 * counted APPROVED-only, another counted APPROVED-or-PUBLISHED) and no
 * bucket at all for PUBLISHED/CLOSED/CANCELLED requests -- so the KPI row
 * never summed to the real total. Every `VacancyRequestStatus` maps to
 * exactly one bucket below, so
 * draft+pending+approved+published+closed+rejected+cancelled always equals
 * total by construction (asserted in vacancyRequestStats.test.ts).
 */
export function summarizeVacancyRequestStatuses(
  rows: { status: VacancyRequestStatus }[],
): VacancyRequestStatusBuckets {
  return {
    total: rows.length,
    draft: rows.filter((r) => r.status === "DRAFT").length,
    pending: rows.filter((r) => PENDING_STATUSES.includes(r.status)).length,
    approved: rows.filter((r) => r.status === "APPROVED").length,
    published: rows.filter((r) => r.status === "PUBLISHED").length,
    closed: rows.filter((r) => r.status === "CLOSED").length,
    rejected: rows.filter((r) => r.status === "REJECTED").length,
    cancelled: rows.filter((r) => r.status === "CANCELLED").length,
  };
}
