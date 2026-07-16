import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { getDashboardKpis } from "@/api/dashboard";
import { downloadAdBriefingExport } from "@/api/reports";
import type { DashboardKpis, StaffRoleCategory } from "@/api/types";
import { useCampus } from "@/campus/CampusContext";
import { DateRangeControl, type DateRangeValue } from "@/components/dashboard/DateRangeControl";
import { StatTile, type StatAccent } from "@/components/dashboard/StatTile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const KPI_CARDS: { key: keyof DashboardKpis; label: string; accent: StatAccent }[] = [
  { key: "total_applications", label: "Total applications", accent: "gold" },
  { key: "open_positions", label: "Open positions", accent: "gold" },
  { key: "interviews_today", label: "Interviews today", accent: "gold" },
  { key: "joinings_today", label: "Joinings today", accent: "green" },
  { key: "offers_pending", label: "Offers pending", accent: "orange" },
  { key: "average_time_to_hire_days", label: "Avg. time to hire (days)", accent: "gold" },
  { key: "vacancy_closure_rate_pct", label: "Vacancy closure rate (%)", accent: "green" },
];

const ROLE_CATEGORIES: { key: StaffRoleCategory; label: string }[] = [
  { key: "TEACHING", label: "Teaching" },
  { key: "NON_TEACHING", label: "Non-Teaching" },
  { key: "HOUSEKEEPING", label: "Housekeeping" },
];

export function DashboardPage() {
  const { selectedCampusCode } = useCampus();
  const [dateRange, setDateRange] = useState<DateRangeValue>({ startDate: null, endDate: null });
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard-kpis", selectedCampusCode, dateRange.startDate, dateRange.endDate],
    queryFn: () => getDashboardKpis(selectedCampusCode, dateRange),
  });

  // Category-wise split isn't a separate backend field -- it's the same
  // /dashboard/kpis endpoint called once per role_category, reusing the
  // filter the backend already supports rather than adding a new one.
  // Unrolled explicitly (not ROLE_CATEGORIES.map(() => useQuery(...))) so
  // hook calls stay static and easy to verify, per React's rules of hooks.
  const dateKey = [selectedCampusCode, dateRange.startDate, dateRange.endDate] as const;
  const teachingQuery = useQuery({
    queryKey: ["dashboard-kpis", "category", "TEACHING", ...dateKey],
    queryFn: () => getDashboardKpis(selectedCampusCode, dateRange, "TEACHING"),
  });
  const nonTeachingQuery = useQuery({
    queryKey: ["dashboard-kpis", "category", "NON_TEACHING", ...dateKey],
    queryFn: () => getDashboardKpis(selectedCampusCode, dateRange, "NON_TEACHING"),
  });
  const housekeepingQuery = useQuery({
    queryKey: ["dashboard-kpis", "category", "HOUSEKEEPING", ...dateKey],
    queryFn: () => getDashboardKpis(selectedCampusCode, dateRange, "HOUSEKEEPING"),
  });
  const categoryQueries = [teachingQuery, nonTeachingQuery, housekeepingQuery];

  async function handleExport() {
    setExportError(null);
    setIsExporting(true);
    try {
      await downloadAdBriefingExport({ campusCode: selectedCampusCode });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  }

  if (isError) {
    return <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Failed to load"}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight">Executive Dashboard</h1>
          <div className="gear-edge mt-2 w-24" />
          <p className="mt-2 text-sm text-muted-foreground">{isLoading ? "Loading…" : data?.scope_note}</p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangeControl value={dateRange} onChange={setDateRange} />
          <Button variant="outline" size="sm" disabled={isExporting} onClick={() => void handleExport()}>
            {isExporting ? "Exporting…" : "Export briefing"}
          </Button>
        </div>
      </div>
      {exportError ? <p className="text-sm text-destructive">{exportError}</p> : null}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {KPI_CARDS.map(({ key, label, accent }) => (
          <StatTile
            key={key}
            label={label}
            value={isLoading ? undefined : (data?.[key] as number | string | null | undefined)}
            isLoading={isLoading}
            accent={accent}
            zeroCaption="No activity in this scope yet"
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Source-wise split</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div role="status" aria-label="Loading source split" className="h-16 animate-pulse rounded bg-muted" />
            ) : !data || data.source_wise_breakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground">No applications in this scope yet.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {data.source_wise_breakdown.map((row) => (
                  <li key={row.source} className="flex items-center justify-between">
                    <span>{row.source}</span>
                    <span className="font-display font-semibold tabular-nums">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Category-wise split</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {ROLE_CATEGORIES.map(({ key, label }, i) => {
                const q = categoryQueries[i];
                return (
                  <li key={key} className="flex items-center justify-between">
                    <span>{label}</span>
                    {q.isLoading ? (
                      <div role="status" aria-label={`Loading ${label}`} className="h-4 w-8 animate-pulse rounded bg-muted" />
                    ) : (
                      <span className="font-display font-semibold tabular-nums">
                        {q.data?.total_applications ?? "—"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rejected vs withdrawn</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div role="status" aria-label="Loading rejected vs withdrawn" className="h-16 animate-pulse rounded bg-muted" />
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                <li className="flex items-center justify-between">
                  <span>Rejected</span>
                  <span className="font-display font-semibold tabular-nums">{data?.rejected_count ?? 0}</span>
                </li>
                <li className="flex items-center justify-between">
                  <span>Withdrawn</span>
                  <span className="font-display font-semibold tabular-nums">{data?.withdrawn_count ?? 0}</span>
                </li>
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Campus-wise hiring</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div role="status" aria-label="Loading campus-wise hiring" className="h-24 animate-pulse rounded bg-muted" />
          ) : !data || data.campus_wise_hiring.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hires recorded in this scope yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-1.5 font-medium">Campus</th>
                  <th className="py-1.5 font-medium">Hired</th>
                  <th className="py-1.5 font-medium">Open</th>
                  <th className="py-1.5 font-medium">In progress</th>
                </tr>
              </thead>
              <tbody>
                {data.campus_wise_hiring.map((row) => (
                  <tr key={row.campus_code} className="border-b border-border last:border-0">
                    <td className="py-1.5 font-mono text-xs">{row.campus_code}</td>
                    <td className="py-1.5 font-display font-semibold tabular-nums">{row.hired_count}</td>
                    <td className="py-1.5 tabular-nums">{row.open_count}</td>
                    <td className="py-1.5 tabular-nums">{row.in_progress_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
