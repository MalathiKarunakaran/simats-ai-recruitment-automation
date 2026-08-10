import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { getDashboardKpis } from "@/api/dashboard";
import { downloadAdBriefingExport } from "@/api/reports";
import type { CategoryBreakdownRow, DashboardKpis, StaffRoleCategory } from "@/api/types";
import { useCampus } from "@/campus/CampusContext";
import { CampusHiringChart } from "@/components/dashboard/CampusHiringChart";
import { CategoryBarChart } from "@/components/dashboard/CategoryBarChart";
import { DateRangeControl, type DateRangeValue } from "@/components/dashboard/DateRangeControl";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { StatTile, type StatAccent } from "@/components/dashboard/StatTile";
import { CategoryTabs, type CategoryTabValue } from "@/components/domain/CategoryTabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCategoryTabState } from "@/hooks/useCategoryTabState";

const KPI_CARDS: { key: keyof DashboardKpis; label: string; accent: StatAccent; tooltip?: string }[] = [
  { key: "total_applications", label: "Total applications", accent: "gold" },
  {
    key: "open_positions",
    label: "Open positions",
    accent: "gold",
    // Precise definition, on hover -- counts individual OPEN HiringSlot
    // rows (posts), not vacancy requests, so it isn't directly comparable
    // to "Total requests" on the Vacancy Requests screen (CLAUDE.md B2).
    tooltip: "Open HiringSlot posts in scope (not requests) -- OPEN status only, RESERVED/FILLED excluded.",
  },
  // interviews_today/joinings_today's own labels are computed per-render
  // below (see todayScopedLabel) since the backend genuinely scopes them to
  // whatever the page's date-range control selects, defaulting to the
  // literal calendar day only when no range is chosen -- a hardcoded
  // "today" label was wrong the moment a wider range was selected
  // (CLAUDE.md B4).
  { key: "interviews_today", label: "Interviews", accent: "gold" },
  { key: "joinings_today", label: "Joinings", accent: "green" },
  { key: "offers_pending", label: "Offers pending", accent: "orange" },
  { key: "average_time_to_hire_days", label: "Avg. time to hire (days)", accent: "gold" },
  { key: "vacancy_closure_rate_pct", label: "Vacancy closure rate (%)", accent: "green" },
];

const TODAY_SCOPED_KEYS: (keyof DashboardKpis)[] = ["interviews_today", "joinings_today"];

/** interviews_today/joinings_today are unconditionally scoped server-side to
 * whatever date range is selected, defaulting to the literal calendar day
 * only when none is -- see reporting.py's range_start/range_end. This makes
 * the tile label match that real scope instead of always saying "today". */
function todayScopedLabel(base: string, range: DateRangeValue): string {
  if (!range.startDate && !range.endDate) return `${base} today`;
  if (range.startDate === range.endDate) return `${base} on ${range.startDate}`;
  return `${base} (${range.startDate ?? "…"} – ${range.endDate ?? "…"})`;
}

const ROLE_CATEGORY_LABELS: Record<StaffRoleCategory, string> = {
  TEACHING: "Teaching",
  NON_TEACHING: "Non-Teaching",
  HOUSEKEEPING: "Housekeeping",
};

// category_wise_breakdown always has exactly 3 rows (one per
// StaffRoleCategoryEnum value), so this fallback only matters before the
// first successful fetch -- keeps the split card's row order/labels stable
// even while data is undefined.
const EMPTY_CATEGORY_BREAKDOWN: CategoryBreakdownRow[] = [
  { role_category: "TEACHING", applications: 0, open_positions: 0, hires: 0 },
  { role_category: "NON_TEACHING", applications: 0, open_positions: 0, hires: 0 },
  { role_category: "HOUSEKEEPING", applications: 0, open_positions: 0, hires: 0 },
];

function toRoleCategoryParam(tab: CategoryTabValue): StaffRoleCategory | undefined {
  return tab === "ALL" ? undefined : tab;
}

export function DashboardPage() {
  const { selectedCampusCode } = useCampus();
  const [dateRange, setDateRange] = useState<DateRangeValue>({ startDate: null, endDate: null });
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [categoryTab, setCategoryTab] = useCategoryTabState();

  // Single call to /dashboard/kpis serves both the top-line KPI strip (which
  // *does* respect categoryTab, via the role_category param) and the
  // category-wise split card below (whose category_wise_breakdown field the
  // backend deliberately always returns unfiltered, regardless of this same
  // param -- see api/types.ts's CategoryBreakdownRow doc comment). Replaces
  // the old pattern of calling this endpoint 3x more (once per category)
  // just to read total_applications out of each.
  const roleCategoryParam = toRoleCategoryParam(categoryTab);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard-kpis", selectedCampusCode, dateRange.startDate, dateRange.endDate, roleCategoryParam],
    queryFn: () => getDashboardKpis(selectedCampusCode, dateRange, roleCategoryParam),
  });

  const categoryBreakdown = data?.category_wise_breakdown ?? EMPTY_CATEGORY_BREAKDOWN;
  const categoryTabCounts = {
    all: categoryBreakdown.reduce((sum, row) => sum + row.applications, 0),
    teaching: categoryBreakdown.find((row) => row.role_category === "TEACHING")?.applications ?? 0,
    nonTeaching: categoryBreakdown.find((row) => row.role_category === "NON_TEACHING")?.applications ?? 0,
    housekeeping: categoryBreakdown.find((row) => row.role_category === "HOUSEKEEPING")?.applications ?? 0,
  };
  const categoryBreakdownIsEmpty = categoryBreakdown.every(
    (row) => row.applications === 0 && row.open_positions === 0 && row.hires === 0,
  );

  const rejectedWithdrawnData = [
    { label: "Rejected", value: data?.rejected_count ?? 0 },
    { label: "Withdrawn", value: data?.withdrawn_count ?? 0 },
  ];

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

      <div className="flex flex-wrap items-center gap-2">
        <CategoryTabs
          value={categoryTab}
          onValueChange={setCategoryTab}
          counts={categoryTabCounts}
        />
        <p className="text-[11px] text-muted-foreground">
          Scopes the KPI tiles below. The category-wise split card always shows all 3 categories.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {KPI_CARDS.map(({ key, label, accent, tooltip }) => (
          <StatTile
            key={key}
            label={TODAY_SCOPED_KEYS.includes(key) ? todayScopedLabel(label, dateRange) : label}
            value={isLoading ? undefined : (data?.[key] as number | string | null | undefined)}
            isLoading={isLoading}
            accent={accent}
            zeroCaption="No activity in this scope yet"
            tooltip={tooltip}
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
              <EmptyState message="No applications in this scope yet." />
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
            {/* Deliberately not scoped by the tabs above -- the backend's
                category_wise_breakdown field always returns all 3 categories
                regardless of the KPI strip's own role_category filter (see
                api/types.ts's CategoryBreakdownRow doc comment), so this note
                keeps that distinction visible instead of letting the card
                silently look "filtered" like the strip above it. */}
            <p className="text-[10px] font-normal text-muted-foreground">
              Always all categories -- unaffected by the tabs above.
            </p>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {isLoading ? (
              <div role="status" aria-label="Loading category split" className="h-16 animate-pulse rounded bg-muted" />
            ) : categoryBreakdownIsEmpty ? (
              // category_wise_breakdown always has exactly 3 rows (one per
              // fixed role category), so an empty-data check can't be
              // `.length === 0` like the widget above -- this used to always
              // render a chart of 3 zero-height bars instead (CLAUDE.md B5).
              <EmptyState message="No applications in this scope yet." />
            ) : (
              <table className="w-full text-xs" aria-label="Category-wise split">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-1 font-medium">Category</th>
                    <th className="py-1 text-right font-medium">Applications</th>
                    <th className="py-1 text-right font-medium">Open positions</th>
                    <th className="py-1 text-right font-medium">Hires</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryBreakdown.map((row) => (
                    <tr key={row.role_category} className="border-b border-border last:border-0">
                      <td className="py-1 font-medium text-foreground">{ROLE_CATEGORY_LABELS[row.role_category]}</td>
                      <td className="py-1 text-right tabular-nums">{row.applications}</td>
                      <td className="py-1 text-right tabular-nums">{row.open_positions}</td>
                      <td className="py-1 text-right tabular-nums">{row.hires}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
            ) : rejectedWithdrawnData.every((row) => row.value === 0) ? (
              <EmptyState message="No rejections or withdrawals in this scope yet." />
            ) : (
              <CategoryBarChart ariaLabel="Rejected vs withdrawn" data={rejectedWithdrawnData} color="var(--color-chart-4)" />
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
            <EmptyState message="No hires recorded in this scope yet." />
          ) : (
            <CampusHiringChart data={data.campus_wise_hiring} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
