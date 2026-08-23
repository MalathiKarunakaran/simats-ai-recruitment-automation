import type { RecentEmployeeEventRow } from "@/api/types";
import { EmptyState } from "@/components/dashboard/EmptyState";

interface RecentActivityFeedProps {
  joins: RecentEmployeeEventRow[];
  resignations: RecentEmployeeEventRow[];
  isLoading?: boolean;
  /** Caps how many merged rows render -- this is a compact "teaser" feed
   * (see the Recent joins / Recent resignations full tables further down the
   * page for the complete lists), not meant to grow unbounded. */
  limit?: number;
}

type ActivityKind = "join" | "resignation";

interface ActivityRow {
  kind: ActivityKind;
  key: string;
  description: string;
  date: string;
}

/**
 * Compact "Recent Activity" teaser feed (Executive Dashboard redesign,
 * 2026-08-23) -- merges DashboardKpis.recent_joins and .recent_resignations
 * (both already fetched by the page, no new API call) into one
 * date-descending list, each row a colored dot + one-line description. Only
 * covers joins/resignations honestly -- "vacancy requested"/"vacancy
 * approved"/"candidate selected" event types aren't available on this
 * endpoint (would need a new backend endpoint or the role-gated Audit Log),
 * so this deliberately doesn't invent them.
 */
export function RecentActivityFeed({ joins, resignations, isLoading = false, limit = 6 }: RecentActivityFeedProps) {
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
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  if (rows.length === 0) {
    return <EmptyState message="No joins or resignations recorded in this scope yet." />;
  }

  return (
    <ul aria-label="Recent activity" className="flex flex-col gap-2.5">
      {rows.slice(0, limit).map((row) => (
        <li key={row.key} className="flex items-start gap-2.5 text-xs">
          <span
            aria-hidden="true"
            className={
              "mt-1 h-2 w-2 shrink-0 rounded-full " +
              (row.kind === "join" ? "bg-brand-success" : "bg-brand-warning")
            }
          />
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
