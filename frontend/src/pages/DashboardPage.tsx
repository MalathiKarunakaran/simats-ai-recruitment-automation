import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { getDashboardKpis } from "@/api/dashboard";
import { downloadAdBriefingExport } from "@/api/reports";
import type { DashboardKpis, StaffRoleCategory } from "@/api/types";
import { useCampus } from "@/campus/CampusContext";
import { CampusHiringChart } from "@/components/dashboard/CampusHiringChart";
import { CategoryBarChart } from "@/components/dashboard/CategoryBarChart";
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-lg font-bold tracking-tight">Executive Dashboard</h1>
          <div className="gear-edge mt-1 w-20" />
          <p className="mt-1 text-xs text-muted-foreground">{isLoading ? "Loading…" : data?.scope_note}</p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangeControl value={dateRange} onChange={setDateRange} />
          <Button variant="outline" size="sm" disabled={isExporting} onClick={() => void handleExport()}>
            {isExporting ? "Exporting…" : "Export briefing"}
          </Button>
        </div>
      </div>
      {exportError ? <p className="text-sm text-destructive">{exportError}</p> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
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

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs">Source-wise split</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {isLoading ? (
              <div role="status" aria-label="Loading source split" className="h-14 animate-pulse rounded bg-muted" />
            ) : !data || data.source_wise_breakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground">No applications in this scope yet.</p>
            ) : (
              <CategoryBarChart
                ariaLabel="Source-wise split"
                data={data.source_wise_breakdown.map((row) => ({ label: row.source, value: row.count }))}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs">Category-wise split</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {categoryQueries.some((q) => q.isLoading) ? (
              <div role="status" aria-label="Loading category split" className="h-14 animate-pulse rounded bg-muted" />
            ) : (
              <CategoryBarChart
                ariaLabel="Category-wise split"
                data={ROLE_CATEGORIES.map(({ label }, i) => ({
                  label,
                  value: categoryQueries[i]?.data?.total_applications ?? 0,
                }))}
                color="var(--color-chart-2)"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs">Rejected vs withdrawn</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {isLoading ? (
              <div role="status" aria-label="Loading rejected vs withdrawn" className="h-14 animate-pulse rounded bg-muted" />
            ) : (
              <CategoryBarChart
                ariaLabel="Rejected vs withdrawn"
                data={[
                  { label: "Rejected", value: data?.rejected_count ?? 0 },
                  { label: "Withdrawn", value: data?.withdrawn_count ?? 0 },
                ]}
                color="var(--color-chart-4)"
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-xs">Campus-wise hiring</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          {isLoading ? (
            <div role="status" aria-label="Loading campus-wise hiring" className="h-24 animate-pulse rounded bg-muted" />
          ) : !data || data.campus_wise_hiring.length === 0 ? (
            <p className="text-xs text-muted-foreground">No hires recorded in this scope yet.</p>
          ) : (
            <CampusHiringChart data={data.campus_wise_hiring} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
