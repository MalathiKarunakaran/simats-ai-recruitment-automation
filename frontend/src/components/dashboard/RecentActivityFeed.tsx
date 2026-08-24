import type { RecentEmployeeEventRow } from "@/api/types";
import { EmptyState } from "@/components/dashboard/EmptyState";

/** Minimal shape for the vacancy-requested/vacancy-approved events below --
 * both are derived client-side from the already-fetched VacancyRequestRead
 * list (see DashboardPage.tsx), so this is deliberately just the 2 fields
 * this feed actually renders, not the full VacancyRequestRead shape. */
export interface VacancyLifecycleActivityRow {
  position_title: string;
  date: string;
}

interface RecentActivityFeedProps {
  joins: RecentEmployeeEventRow[];
  resignations: RecentEmployeeEventRow[];
  /** "Vacancy requested" events -- one per VacancyRequestRead row with a
   * non-null `submitted_at`, dated by that same field (follow-up patch,
   * 2026-08-23). Optional/defaulted to `[]` so this stays additive. */
  vacancyRequested?: VacancyLifecycleActivityRow[];
  /** "Vacancy approved" events -- one per VacancyRequestRead row with a
   * non-null `hr_reviewed_at` (HR/final approval, not the Dean's earlier
   * review step), dated by that same field. Optional/defaulted to `[]`. */
  vacancyApproved?: VacancyLifecycleActivityRow[];
  isLoading?: boolean;
  /** Caps how many merged rows render -- this is a compact "teaser" feed
   * (see the Recent joins / Recent resignations full tables further down the
   * page for the complete lists), not meant to grow unbounded. Bumped from
   * 6 to 8 (follow-up patch, 2026-08-23) now that 2 more event types
   * (requested/approved) can compete for the same slots. */
  limit?: number;
}

type ActivityKind = "join" | "resignation" | "requested" | "approved";

interface ActivityRow {
  kind: ActivityKind;
  key: string;
  description: string;
  date: string;
}

const DOT_CLASS_BY_KIND: Record<ActivityKind, string> = {
  join: "bg-brand-success",
  resignation: "bg-brand-warning",
  requested: "bg-brand-primary",
  approved: "bg-brand-success",
};

/**
 * Compact "Recent Activity" teaser feed (Executive Dashboard redesign,
 * 2026-08-23; extended with vacancy requested/approved events in the
 * mockup-comparison follow-up patch, same day) -- merges
 * DashboardKpis.recent_joins/.recent_resignations with vacancy-requested/
 * vacancy-approved events derived from the already-fetched vacancy-requests
 * list (no new API call for any of the 4 event types) into one
 * date-descending list, each row a colored dot + one-line description.
 * "Candidate selected" is still deliberately not covered -- that would need
 * an applications-list fetch this page doesn't currently make, out of scope
 * for this pass (unlike requested/approved, which reuse data already on the
 * page).
 */
export function RecentActivityFeed({
  joins,
  resignations,
  vacancyRequested = [],
  vacancyApproved = [],
  isLoading = false,
  limit = 8,
}: RecentActivityFeedProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2" role="status" aria-label="Loading recent activity">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-8 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }

  const rows: ActivityRow[] = [
    ...joins.map((row, index) => ({
      kind: "join" as const,
      key: `join-${row.employee_name}-${row.date}-${index}`,
      description: `${row.employee_name} joined as ${row.designation}${row.department ? ` in ${row.department}` : ""}`,
      date: row.date,
    })),
    ...resignations.map((row, index) => ({
      kind: "resignation" as const,
      key: `resignation-${row.employee_name}-${row.date}-${index}`,
      description: `${row.employee_name} resigned from ${row.department ?? row.designation}`,
      date: row.date,
    })),
    ...vacancyRequested.map((row, index) => ({
      kind: "requested" as const,
      key: `requested-${row.position_title}-${row.date}-${index}`,
      description: `Vacancy requested — ${row.position_title}`,
      date: row.date,
    })),
    ...vacancyApproved.map((row, index) => ({
      kind: "approved" as const,
      key: `approved-${row.position_title}-${row.date}-${index}`,
      description: `Vacancy approved — ${row.position_title}`,
      date: row.date,
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  if (rows.length === 0) {
    return <EmptyState message="No recent activity recorded in this scope yet." />;
  }

  return (
    <ul aria-label="Recent activity" className="flex flex-col gap-2.5">
      {rows.slice(0, limit).map((row) => (
        <li key={row.key} className="flex items-start gap-2.5 text-xs">
          <span aria-hidden="true" className={"mt-1 h-2 w-2 shrink-0 rounded-full " + DOT_CLASS_BY_KIND[row.kind]} />
          <div className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
            <p className="truncate text-foreground">{row.description}</p>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {new Date(row.date).toLocaleDateString()}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
