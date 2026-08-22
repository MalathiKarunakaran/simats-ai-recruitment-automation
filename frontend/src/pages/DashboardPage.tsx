import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { getDashboardKpis } from "@/api/dashboard";
import { downloadAdBriefingExport } from "@/api/reports";
import type { CategoryBreakdownRow, DashboardKpis, StaffRoleCategory } from "@/api/types";
import { listVacancyRequests } from "@/api/vacancyRequests";
import { useCampus } from "@/campus/CampusContext";
import { CampusHiringChart } from "@/components/dashboard/CampusHiringChart";
import { CategoryBarChart } from "@/components/dashboard/CategoryBarChart";
import { DateRangeControl, type DateRangeValue } from "@/components/dashboard/DateRangeControl";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { StatTile, type StatAccent } from "@/components/dashboard/StatTile";
import { CategoryTabs, type CategoryTabValue } from "@/components/domain/CategoryTabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCategoryTabState } from "@/hooks/useCategoryTabState";
import { summarizeVacancyRequestStatuses } from "@/lib/vacancyRequestStats";

const KPI_CARDS: {
  key: keyof DashboardKpis;
  label: string;
  accent: StatAccent;
  tooltip?: string;
  /** Overrides the strip's shared "No activity in this scope yet" default --
   * some of these tiles have a zero value that means something more specific
   * than "nothing happened here". */
  zeroCaption?: string;
  /** UI redesign Phase 2: set on ONLY total_applications -- the page's one
   * hero KPI tile (StatTile's own `hero` prop, consuming
   * --brand-signature-gradient). Every other tile below, including the
   * Phase I Sanctioned Strength trio, is untouched. */
  hero?: boolean;
}[] = [
  { key: "total_applications", label: "Total applications", accent: "gold", hero: true },
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
  // Phase I (glowing-zooming-hamming.md) Sanctioned Strength tiles. "none"
  // (unused by any of the 7 tiles above) intentionally sets these two apart
  // as a distinct neutral-toned group rather than reusing gold/green/orange,
  // which already carry "activity" connotations that don't fit a headcount
  // register. All 3 respect the category tabs above (role_category), same as
  // open_positions etc. -- unlike the always-all-3-categories split card.
  {
    key: "sanctioned_approved_total",
    label: "Sanctioned approved",
    accent: "none",
    tooltip:
      "Sum of approved_strength across every current-effective Sanctioned Strength row in scope (respects the category tabs above).",
  },
  {
    key: "sanctioned_working_total",
    label: "Sanctioned working",
    accent: "none",
    tooltip:
      "Live headcount currently working against those same rows -- Employees for Teaching/Non-Teaching, active Housekeeping Staff for Housekeeping.",
    zeroCaption: "No staff currently working against sanctioned strength in this scope",
  },
  {
    key: "sanctioned_vacancy_total",
    label: "Sanctioned vacancy",
    // Static fallback only (used while loading / non-numeric) -- the real
    // accent below reacts to the value's sign so a negative "net
    // overstaffed" figure doesn't read as a rendering glitch next to 9
    // otherwise-nonnegative tiles.
    accent: "gold",
    tooltip:
      "Sanctioned approved minus sanctioned working, net across scope -- NOT the sum of each row's vacancy floored at 0. Negative means net overstaffed overall, not \"no vacancy\".",
    zeroCaption: "Fully staffed -- no net vacancy or overstaffing in this scope",
  },
  // Step 3 (dashboard-kpi-additions) -- the one KPI on this whole strip
  // meant to grab attention, hence StatTile's new "red" accent (--brand-danger)
  // rather than reusing gold/green/orange, none of which read as "urgent" in
  // this app's fixed color spec (Red = urgent/destructive, index.css).
  {
    key: "urgent_vacancy_count",
    label: "Urgent vacancies",
    accent: "red",
    tooltip:
      "Vacancy requests in scope with priority = URGENT, excluding CLOSED/REJECTED/CANCELLED ones -- a current-state count, not scoped to the date range above (respects the category tabs above).",
    zeroCaption: "No urgent vacancies right now",
  },
];

/** sanctioned_vacancy_total is the one KPI that can legitimately go negative
 * (net overstaffed) -- everything else on this strip is a nonnegative count.
 * Color-coding by sign (gold = real vacancy to recruit for, green = exactly
 * staffed, orange = overstaffed) makes the sign read as meaningful, not as a
 * rendering bug, without needing a new StatAccent variant. */
function vacancyAccent(value: number | string | null | undefined, fallback: StatAccent): StatAccent {
  if (typeof value !== "number") return fallback;
  if (value < 0) return "orange";
  if (value === 0) return "green";
  return "gold";
}

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

  const pipelineFunnelData = (data?.application_pipeline_funnel ?? []).map((row) => ({
    label: row.stage,
    value: row.count,
  }));
  const pipelineFunnelIsEmpty = (data?.application_pipeline_funnel ?? []).every((row) => row.count === 0);

  const criticalVacancies = data?.critical_vacancies ?? [];
  const recentJoins = data?.recent_joins ?? [];
  const recentResignations = data?.recent_resignations ?? [];

  // "Pending Requests" / "Pending Approvals" -- composed from the existing
  // /vacancy-requests list endpoint (no new backend field), the same way
  // VacancyRequestsListPage's own KPI strip does: fetched unfiltered
  // (status=null) and bucketed with the single shared
  // summarizeVacancyRequestStatuses() so this never invents a third,
  // diverging definition of "pending" (CLAUDE.md-style rule this codebase
  // already follows for that page). Deliberately not scoped by the category
  // tabs/date range above -- same "always reflects the whole scope" choice
  // VacancyRequestsListPage's own KPI strip makes for its equivalent tiles.
  const { data: vacancyRequests, isLoading: isVacancyRequestsLoading } = useQuery({
    queryKey: ["vacancy-requests", "ALL"],
    queryFn: () => listVacancyRequests(null),
  });
  const vacancyRequestBuckets = summarizeVacancyRequestStatuses(vacancyRequests ?? []);
  // "Pending Requests" = SUBMITTED + DEAN_APPROVED -- VacancyRequestsListPage's
  // own `pending` bucket (rendered there as its "Pending approval" tile).
  const pendingRequestsCount = vacancyRequestBuckets.pending;
  // "Pending Approvals" = SUBMITTED + DEAN_APPROVED + APPROVED -- the union of
  // every status any role's ACTIONABLE_STATUSES_BY_ROLE on VacancyApprovalsPage
  // can act on (SUPER_ADMIN's own list is exactly this superset), i.e. every
  // request still awaiting *some* approver's next action anywhere in the
  // chain. Composed from the same shared buckets as pendingRequestsCount
  // above (pending + approved), not a separately re-invented filter.
  const pendingApprovalsCount = vacancyRequestBuckets.pending + vacancyRequestBuckets.approved;

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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-5">
        {KPI_CARDS.map(({ key, label, accent, tooltip, zeroCaption, hero }) => {
          const value = isLoading ? undefined : (data?.[key] as number | string | null | undefined);
          return (
            <StatTile
              key={key}
              label={TODAY_SCOPED_KEYS.includes(key) ? todayScopedLabel(label, dateRange) : label}
              value={value}
              isLoading={isLoading}
              accent={key === "sanctioned_vacancy_total" ? vacancyAccent(value, accent) : accent}
              zeroCaption={zeroCaption ?? "No activity in this scope yet"}
              tooltip={tooltip}
              hero={hero}
            />
          );
        })}
      </div>

      {/* Pending Requests / Pending Approvals -- composed client-side from the
          existing /vacancy-requests list, not new /dashboard/kpis fields (see
          the pendingRequestsCount/pendingApprovalsCount comment above). A
          separate small row (not folded into KPI_CARDS above) since these two
          come from a different query than the rest of the strip. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-5">
        <StatTile
          label="Pending requests"
          value={isVacancyRequestsLoading ? undefined : pendingRequestsCount}
          isLoading={isVacancyRequestsLoading}
          accent="gold"
          tooltip="Vacancy requests awaiting the next actor in the approval chain -- status SUBMITTED or DEAN_APPROVED."
          zeroCaption="No requests waiting on an approver right now"
        />
        <StatTile
          label="Pending approvals"
          value={isVacancyRequestsLoading ? undefined : pendingApprovalsCount}
          isLoading={isVacancyRequestsLoading}
          accent="orange"
          tooltip="Vacancy requests still actionable by some approver -- status SUBMITTED, DEAN_APPROVED, or APPROVED (ready to publish)."
          zeroCaption="Nothing awaiting approval or publishing right now"
        />
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

      {/* Recruitment pipeline funnel -- application_pipeline_funnel is always
          exactly 7 rows (Applied -> Screening -> Interview -> Selected ->
          Offer -> Joined -> Rejected), always in that fixed order (see
          api/types.ts's PipelineFunnelStage doc comment) -- rendered as-is,
          never re-sorted, via the same CategoryBarChart horizontal-bar
          component already used for source-wise/rejected-vs-withdrawn above
          (no new charting library needed for a "decreasing widths" funnel
          look; the real data's own counts naturally taper stage over stage). */}
      <Card>
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-xs">Recruitment pipeline funnel</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          {isLoading ? (
            <div role="status" aria-label="Loading recruitment pipeline funnel" className="h-32 animate-pulse rounded bg-muted" />
          ) : !data || pipelineFunnelIsEmpty ? (
            <EmptyState message="No applications in this scope yet." />
          ) : (
            <CategoryBarChart ariaLabel="Recruitment pipeline funnel" data={pipelineFunnelData} color="var(--color-chart-2)" />
          )}
        </CardContent>
      </Card>

      {/* Critical vacancies -- VACANCY_RECRUITMENT_REQUIRED-status rows
          surfaced from the Sanctioned Strength views (see
          app/services/reporting.py::_critical_vacancy_rows). An empty list
          here is a genuinely good sign, not a loading/error state -- worded
          accordingly rather than the generic "No results found." */}
      <Card>
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-xs">Critical vacancies</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table aria-label="Critical vacancies">
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Vacancies</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableEmpty colSpan={5} loading />
              ) : criticalVacancies.length === 0 ? (
                <TableEmpty colSpan={5}>No critical vacancies right now -- nothing urgently understaffed.</TableEmpty>
              ) : (
                criticalVacancies.map((row, index) => (
                  <TableRow key={`${row.department}-${row.designation}-${index}`}>
                    <TableCell className="font-medium text-foreground">{row.department}</TableCell>
                    <TableCell>{row.designation}</TableCell>
                    <TableCell>{row.location ?? "—"}</TableCell>
                    <TableCell>{row.category.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.vacancy_count}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Recent joins / Recent resignations -- 2 separate cards (per the
          original spec's distinct "D."/"E." sections), each a top-10 list of
          Employee rows already ordered newest-first by the backend. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs">Recent joins</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table aria-label="Recent joins">
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Designation</TableHead>
                  <TableHead>Campus</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableEmpty colSpan={5} loading />
                ) : recentJoins.length === 0 ? (
                  <TableEmpty colSpan={5}>No joinings recorded in this scope yet.</TableEmpty>
                ) : (
                  recentJoins.map((row, index) => (
                    <TableRow key={`${row.employee_name}-${row.date}-${index}`}>
                      <TableCell className="font-medium text-foreground">{row.employee_name}</TableCell>
                      <TableCell>{row.department ?? "—"}</TableCell>
                      <TableCell>{row.designation}</TableCell>
                      <TableCell>{row.campus}</TableCell>
                      <TableCell>{new Date(row.date).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs">Recent resignations</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table aria-label="Recent resignations">
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Designation</TableHead>
                  <TableHead>Campus</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableEmpty colSpan={5} loading />
                ) : recentResignations.length === 0 ? (
                  <TableEmpty colSpan={5}>No resignations recorded in this scope yet.</TableEmpty>
                ) : (
                  recentResignations.map((row, index) => (
                    <TableRow key={`${row.employee_name}-${row.date}-${index}`}>
                      <TableCell className="font-medium text-foreground">{row.employee_name}</TableCell>
                      <TableCell>{row.department ?? "—"}</TableCell>
                      <TableCell>{row.designation}</TableCell>
                      <TableCell>{row.campus}</TableCell>
                      <TableCell>{new Date(row.date).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
