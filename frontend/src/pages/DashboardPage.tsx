import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Briefcase,
  Building2,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileCheck,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { getDashboardKpis } from "@/api/dashboard";
import { downloadAdBriefingExport } from "@/api/reports";
import type {
  CategoryBreakdownRow,
  CriticalVacancyRow,
  DashboardKpis,
  StaffRoleCategory,
  VacancyRequestRead,
  VacancyRequestStatus,
} from "@/api/types";
import { listVacancyRequests } from "@/api/vacancyRequests";
import { useCampus } from "@/campus/CampusContext";
import { CampusHiringChart } from "@/components/dashboard/CampusHiringChart";
import { CategoryBarChart } from "@/components/dashboard/CategoryBarChart";
import { CategorySummaryCard } from "@/components/dashboard/CategorySummaryCard";
import { DateRangeControl, type DateRangeValue } from "@/components/dashboard/DateRangeControl";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { RecentActivityFeed, type VacancyLifecycleActivityRow } from "@/components/dashboard/RecentActivityFeed";
import { StatTile, type StatAccent, type StatIconColor } from "@/components/dashboard/StatTile";
import { CategoryTabs, type CategoryTabValue } from "@/components/domain/CategoryTabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCategoryTabState } from "@/hooks/useCategoryTabState";
import { cn } from "@/lib/utils";
import { summarizeVacancyRequestStatuses } from "@/lib/vacancyRequestStats";

// Executive Dashboard redesign (2026-08-23): the page's 7 lower-priority KPI
// metrics, demoted to small compact StatTile("compact") chips below the 6
// primary tiles -- see the primary row further down for
// sanctioned_approved_total/sanctioned_working_total/sanctioned_vacancy_total/
// open_positions plus the composed Pending requests/approvals tiles, which
// used to live in this same array pre-redesign.
const SECONDARY_KPI_CARDS: {
  key: keyof DashboardKpis;
  label: string;
  accent: StatAccent;
  icon: typeof Users;
  iconColor: StatIconColor;
  tooltip?: string;
  /** Overrides the strip's shared "No activity in this scope yet" default --
   * some of these tiles have a zero value that means something more specific
   * than "nothing happened here". */
  zeroCaption?: string;
}[] = [
  { key: "total_applications", label: "Total applications", accent: "blue", icon: Users, iconColor: "blue" },
  // interviews_today/joinings_today's own labels are computed per-render
  // below (see todayScopedLabel) since the backend genuinely scopes them to
  // whatever the page's date-range control selects, defaulting to the
  // literal calendar day only when no range is chosen -- a hardcoded
  // "today" label was wrong the moment a wider range was selected
  // (CLAUDE.md B4).
  { key: "interviews_today", label: "Interviews", accent: "blue", icon: CalendarClock, iconColor: "blue" },
  { key: "joinings_today", label: "Joinings", accent: "green", icon: UserPlus, iconColor: "green" },
  { key: "offers_pending", label: "Offers pending", accent: "orange", icon: FileCheck, iconColor: "orange" },
  // "purple" icon tone (Enterprise HRMS dashboard redesign, 2026-08-23) marks
  // these 2 tiles as analytics-flavored metrics (rates/durations computed
  // over the scope, not raw counts) per the redesign brief's own example
  // pairing -- --brand-purple, a dedicated accent distinct from this tile's
  // unrelated `accent` (left-border stripe) prop.
  {
    key: "average_time_to_hire_days",
    label: "Avg. time to hire (days)",
    accent: "blue",
    icon: Clock,
    iconColor: "purple",
  },
  {
    key: "vacancy_closure_rate_pct",
    label: "Vacancy closure rate (%)",
    accent: "green",
    icon: TrendingUp,
    iconColor: "purple",
  },
  // Step 3 (dashboard-kpi-additions) -- the one KPI on this whole strip
  // meant to grab attention, hence StatTile's "red" accent (--brand-danger)
  // rather than reusing blue/green/orange, none of which read as "urgent" in
  // this app's fixed color spec (Red = urgent/destructive, index.css).
  {
    key: "urgent_vacancy_count",
    label: "Urgent vacancies",
    accent: "red",
    icon: AlertTriangle,
    iconColor: "red",
    tooltip:
      "Vacancy requests in scope with priority = URGENT, excluding CLOSED/REJECTED/CANCELLED ones -- a current-state count, not scoped to the date range above (respects the category tabs above).",
    zeroCaption: "No urgent vacancies right now",
  },
];

/** sanctioned_vacancy_total is the one KPI that can legitimately go negative
 * (net overstaffed) -- everything else on this strip is a nonnegative count.
 * Color-coding by sign (orange = real vacancy to recruit for, green = exactly
 * staffed) makes the sign read as meaningful, not as a rendering bug, without
 * needing a new StatAccent variant for it alone. Note: the "Vacancies" tile
 * below renders as this page's one `hero` tile, which visually supersedes
 * this accent's left-border stripe -- the sign is still communicated via the
 * number itself and the zero caption. */
function vacancyAccent(value: number | string | null | undefined, fallback: StatAccent): StatAccent {
  if (typeof value !== "number") return fallback;
  if (value < 0) return "orange";
  if (value === 0) return "green";
  return "gold";
}

/** Same sign-based reasoning as vacancyAccent above, mapped onto StatTile's
 * separate (smaller) icon-chip palette instead of the left-border accent
 * scheme -- "gold" has no icon-chip equivalent, so a positive net vacancy
 * (real recruiting need) uses "orange" here too, matching how this app's
 * fixed color spec already treats "needs attention" states. */
function vacancyIconColor(value: number | string | null | undefined): StatIconColor {
  if (typeof value !== "number") return "blue";
  if (value < 0) return "orange";
  if (value === 0) return "green";
  return "orange";
}

// Enterprise HRMS dashboard redesign (2026-08-23) -- client-side "priority"
// bucket for the Critical vacancies table. NOT a fetched field: critical_vacancies
// has no priority column (see app/schemas/reporting.py::CriticalVacancyRow),
// so this buckets THIS result set's own vacancy_count values into thirds by
// rank (most-vacancies-first) -- top third "High" (red), middle third
// "Medium" (orange), bottom third "Low" (blue). Tie-breaking: rows are sorted
// descending by vacancy_count with a stable sort (Array.prototype.sort is
// stable in every engine this app targets), so equal-count rows keep their
// original relative order; when the third-boundary falls between two equal
// values, the earlier one (after sorting) lands in the higher bucket -- an
// arbitrary but deterministic tie-break, not a meaningful distinction.
// Arrays smaller than 3 rows can't split into 3 even thirds: with 1-2 rows,
// every row is "High" (there's no meaningful "middle"/"low" tier to carve out
// of a literal handful of already-critical rows).
type CriticalVacancyPriority = "High" | "Medium" | "Low";

function computeCriticalVacancyPriorities(
  rows: CriticalVacancyRow[],
): Map<CriticalVacancyRow, CriticalVacancyPriority> {
  const priorities = new Map<CriticalVacancyRow, CriticalVacancyPriority>();
  if (rows.length === 0) return priorities;
  if (rows.length < 3) {
    for (const row of rows) priorities.set(row, "High");
    return priorities;
  }
  const sorted = [...rows].sort((a, b) => b.vacancy_count - a.vacancy_count);
  const thirdSize = Math.ceil(sorted.length / 3);
  sorted.forEach((row, index) => {
    const bucket: CriticalVacancyPriority = index < thirdSize ? "High" : index < thirdSize * 2 ? "Medium" : "Low";
    priorities.set(row, bucket);
  });
  return priorities;
}

const CRITICAL_VACANCY_PRIORITY_BADGE: Record<CriticalVacancyPriority, "destructive" | "warning" | "info"> = {
  High: "destructive",
  Medium: "warning",
  Low: "info",
};

// Recruitment Pipeline's "Approved"/"Published" stages -- cumulative status
// sets (a request that's PUBLISHED has necessarily already been APPROVED, so
// APPROVED counts include PUBLISHED/CLOSED too), matching how the rest of
// this page already treats vacancy-request status as a forward progression.
const APPROVED_OR_LATER_STATUSES: VacancyRequestStatus[] = ["APPROVED", "PUBLISHED", "CLOSED"];
const PUBLISHED_OR_LATER_STATUSES: VacancyRequestStatus[] = ["PUBLISHED", "CLOSED"];

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

  // Category Summary section (Executive Dashboard redesign) -- always all 3
  // categories side by side, deliberately NOT affected by categoryTab above
  // (same "always all 3" convention the Category-wise split card already
  // follows). Reuses the exact same query key shape as the main query above
  // (just with an explicit, fixed role_category instead of the tab-driven
  // one) so selecting e.g. the Teaching tab shares this cache entry with the
  // main query rather than double-fetching.
  const teachingSummary = useQuery({
    queryKey: ["dashboard-kpis", selectedCampusCode, dateRange.startDate, dateRange.endDate, "TEACHING"],
    queryFn: () => getDashboardKpis(selectedCampusCode, dateRange, "TEACHING"),
  });
  const nonTeachingSummary = useQuery({
    queryKey: ["dashboard-kpis", selectedCampusCode, dateRange.startDate, dateRange.endDate, "NON_TEACHING"],
    queryFn: () => getDashboardKpis(selectedCampusCode, dateRange, "NON_TEACHING"),
  });
  const housekeepingSummary = useQuery({
    queryKey: ["dashboard-kpis", selectedCampusCode, dateRange.startDate, dateRange.endDate, "HOUSEKEEPING"],
    queryFn: () => getDashboardKpis(selectedCampusCode, dateRange, "HOUSEKEEPING"),
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

  const criticalVacancies = data?.critical_vacancies ?? [];
  const recentJoins = data?.recent_joins ?? [];
  const recentResignations = data?.recent_resignations ?? [];
  const criticalVacancyPriorities = computeCriticalVacancyPriorities(criticalVacancies);

  // Vacancy Analysis section -- client-side aggregation of critical_vacancies
  // by department (summed vacancy_count), sorted descending, top 6 shown with
  // a "View All" link to the Sanctioned Strength page (no new backend
  // endpoint for this rollup).
  const departmentVacancyTotals = new Map<string, number>();
  for (const row of criticalVacancies) {
    departmentVacancyTotals.set(row.department, (departmentVacancyTotals.get(row.department) ?? 0) + row.vacancy_count);
  }
  const departmentVacancyRows = Array.from(departmentVacancyTotals.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  const departmentVacancyTop6 = departmentVacancyRows.slice(0, 6);

  // Critical vacancies table -- relative highlight for the row(s) at the
  // current result set's single highest vacancy_count (a client-side
  // "unusually high" signal, not a fabricated priority field).
  const criticalVacanciesMax = criticalVacancies.reduce((max, row) => Math.max(max, row.vacancy_count), 0);

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

  // "Vacancy requested"/"Vacancy approved" Recent Activity events (follow-up
  // patch, 2026-08-23) -- derived from this same already-fetched
  // vacancy-requests list, no new query. "Requested" = every row with a
  // non-null submitted_at, dated by that field; "Approved" = every row with
  // a non-null hr_reviewed_at (HR/final approval -- see VacancyRequestRead's
  // own field in api/types.ts; dean_reviewed_at is the earlier, separate
  // Dean-review step, not what "approved" means here), dated by that field.
  // Department name isn't joined/available client-side without an extra
  // fetch, so these events show position_title alone, per this patch's own
  // scope constraint.
  const vacancyRequestedActivity: VacancyLifecycleActivityRow[] = (vacancyRequests ?? [])
    .filter((r): r is VacancyRequestRead & { submitted_at: string } => r.submitted_at !== null)
    .map((r) => ({ position_title: r.position_title, date: r.submitted_at }));
  const vacancyApprovedActivity: VacancyLifecycleActivityRow[] = (vacancyRequests ?? [])
    .filter((r): r is VacancyRequestRead & { hr_reviewed_at: string } => r.hr_reviewed_at !== null)
    .map((r) => ({ position_title: r.position_title, date: r.hr_reviewed_at }));

  // Recruitment Pipeline (Enterprise HRMS dashboard redesign, 2026-08-23) --
  // a literal 7-stage view spanning 2 different real datasets already
  // fetched on this page: Requested/Approved/Published are computed
  // client-side from the same unfiltered vacancy-requests list used for the
  // Pending Requests/Approvals tiles above (counting VacancyRequests, not
  // applications), while Screening/Interview/Selected/Joined are pulled
  // straight out of application_pipeline_funnel by matching `stage` name
  // (counting individual Applications) -- see that field's own fixed-order
  // doc comment in api/types.ts. Deliberately mixes units in one chart (see
  // the caption rendered alongside it below) rather than fabricating a
  // single normalized number that doesn't exist in the real data.
  const vacancyRequestsInScope = vacancyRequests ?? [];
  const requestedCount = vacancyRequestsInScope.filter((r) => r.status !== "DRAFT").length;
  const approvedCumulativeCount = vacancyRequestsInScope.filter((r) =>
    APPROVED_OR_LATER_STATUSES.includes(r.status),
  ).length;
  const publishedCumulativeCount = vacancyRequestsInScope.filter((r) =>
    PUBLISHED_OR_LATER_STATUSES.includes(r.status),
  ).length;
  const funnel = data?.application_pipeline_funnel ?? [];
  const funnelStageCount = (stageName: string) => funnel.find((row) => row.stage === stageName)?.count ?? 0;
  const recruitmentPipelineData = [
    { label: "Requested", value: requestedCount },
    { label: "Approved", value: approvedCumulativeCount },
    { label: "Published", value: publishedCumulativeCount },
    { label: "Screening", value: funnelStageCount("Screening") },
    { label: "Interview", value: funnelStageCount("Interview") },
    { label: "Selected", value: funnelStageCount("Selected") },
    { label: "Joined", value: funnelStageCount("Joined") },
  ];
  const recruitmentPipelineIsLoading = isLoading || isVacancyRequestsLoading;
  const recruitmentPipelineIsEmpty = recruitmentPipelineData.every((row) => row.value === 0);

  // Campus-wise hiring aggregate donut totals -- summed client-side across
  // every campus_wise_hiring row (see CampusHiringChart.tsx, which now
  // renders this as ONE donut instead of a per-campus grouped bar chart).
  const campusWiseHiring = data?.campus_wise_hiring ?? [];

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

  const vacancyValue = isLoading ? undefined : data?.sanctioned_vacancy_total;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-lg font-bold tracking-tight">Executive Dashboard</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">Recruitment and workforce overview</p>
          <div className="gear-edge mt-1.5 w-20" />
          <p className="mt-1 text-[11px] text-muted-foreground/80">{isLoading ? "Loading…" : data?.scope_note}</p>
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
        <CategoryTabs value={categoryTab} onValueChange={setCategoryTab} counts={categoryTabCounts} variant="segmented" />
        <p className="text-[11px] text-muted-foreground">
          Scopes the KPI tiles below. The category-wise split card always shows all 3 categories.
        </p>
      </div>

      {/* Primary KPI row -- exactly 6 tiles, "Vacancies" is this page's one
          hero tile (see StatTile's `hero` prop). Pending requests/approvals
          are composed from the /vacancy-requests list (see above), not this
          page's own /dashboard/kpis response. */}
      <div data-testid="primary-kpi-grid" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Total Sanctioned"
          value={isLoading ? undefined : data?.sanctioned_approved_total}
          isLoading={isLoading}
          accent="blue"
          icon={Users}
          iconColor="blue"
          tooltip="Sum of approved_strength across every current-effective Sanctioned Strength row in scope (respects the category tabs above)."
          zeroCaption="No activity in this scope yet"
        />
        <StatTile
          label="Working"
          value={isLoading ? undefined : data?.sanctioned_working_total}
          isLoading={isLoading}
          accent="green"
          icon={UserCheck}
          iconColor="green"
          tooltip="Live headcount currently working against those same rows -- Employees for Teaching/Non-Teaching, active Housekeeping Staff for Housekeeping."
          zeroCaption="No staff currently working against sanctioned strength in this scope"
        />
        <StatTile
          label="Vacancies"
          value={vacancyValue}
          isLoading={isLoading}
          accent={vacancyAccent(vacancyValue, "gold")}
          icon={Building2}
          iconColor={vacancyIconColor(vacancyValue)}
          tooltip={`Sanctioned approved minus sanctioned working, net across scope -- NOT the sum of each row's vacancy floored at 0. Negative means net overstaffed overall, not "no vacancy".`}
          zeroCaption="Fully staffed -- no net vacancy or overstaffing in this scope"
          hero
        />
        <StatTile
          label="Pending requests"
          value={isVacancyRequestsLoading ? undefined : pendingRequestsCount}
          isLoading={isVacancyRequestsLoading}
          accent="orange"
          icon={ClipboardList}
          iconColor="orange"
          tooltip="Vacancy requests awaiting the next actor in the approval chain -- status SUBMITTED or DEAN_APPROVED."
          zeroCaption="No requests waiting on an approver right now"
        />
        <StatTile
          label="Pending approvals"
          value={isVacancyRequestsLoading ? undefined : pendingApprovalsCount}
          isLoading={isVacancyRequestsLoading}
          accent="orange"
          icon={ClipboardCheck}
          iconColor="orange"
          tooltip="Vacancy requests still actionable by some approver -- status SUBMITTED, DEAN_APPROVED, or APPROVED (ready to publish)."
          zeroCaption="Nothing awaiting approval or publishing right now"
        />
        <StatTile
          label="Active Recruitment"
          value={isLoading ? undefined : data?.open_positions}
          isLoading={isLoading}
          accent="blue"
          icon={Briefcase}
          iconColor="blue"
          // Precise definition, on hover -- counts individual OPEN HiringSlot
          // rows (posts), not vacancy requests, so it isn't directly
          // comparable to "Total requests" on the Vacancy Requests screen
          // (CLAUDE.md B2).
          tooltip="Open HiringSlot posts in scope (not requests) -- OPEN status only, RESERVED/FILLED excluded."
          zeroCaption="No activity in this scope yet"
        />
      </div>

      {/* Secondary stat strip -- 7 lower-priority metrics, visually
          demoted below the primary 6 via StatTile's "compact" size, flowing
          in a wrap rather than a rigid grid. */}
      <div className="flex flex-wrap gap-2">
        {SECONDARY_KPI_CARDS.map(({ key, label, accent, icon, iconColor, tooltip, zeroCaption }) => {
          const value = isLoading ? undefined : (data?.[key] as number | string | null | undefined);
          return (
            <div key={key} className="w-[calc(50%-0.25rem)] sm:w-[152px]">
              <StatTile
                label={TODAY_SCOPED_KEYS.includes(key) ? todayScopedLabel(label, dateRange) : label}
                value={value}
                isLoading={isLoading}
                accent={accent}
                icon={icon}
                iconColor={iconColor}
                zeroCaption={zeroCaption ?? "No activity in this scope yet"}
                tooltip={tooltip}
                size="compact"
              />
            </div>
          );
        })}
      </div>

      {/* Category Summary -- always all 3 categories (Teaching/Non-Teaching/
          Housekeeping) side by side, unaffected by the tabs above. */}
      <div>
        <h2 className="mb-2 font-display text-sm font-semibold text-foreground">Category summary</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <CategorySummaryCard
            title="Teaching"
            sanctioned={teachingSummary.data?.sanctioned_approved_total}
            working={teachingSummary.data?.sanctioned_working_total}
            vacancy={teachingSummary.data?.sanctioned_vacancy_total}
            isLoading={teachingSummary.isLoading}
            accent="blue"
          />
          <CategorySummaryCard
            title="Non-Teaching"
            sanctioned={nonTeachingSummary.data?.sanctioned_approved_total}
            working={nonTeachingSummary.data?.sanctioned_working_total}
            vacancy={nonTeachingSummary.data?.sanctioned_vacancy_total}
            isLoading={nonTeachingSummary.isLoading}
            accent="green"
          />
          <CategorySummaryCard
            title="Housekeeping"
            sanctioned={housekeepingSummary.data?.sanctioned_approved_total}
            working={housekeepingSummary.data?.sanctioned_working_total}
            vacancy={housekeepingSummary.data?.sanctioned_vacancy_total}
            isLoading={housekeepingSummary.isLoading}
            accent="orange"
          />
        </div>
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

      {/* Recruitment pipeline -- Enterprise HRMS dashboard redesign
          (2026-08-23): a literal 7-stage view (Requested -> Approved ->
          Published -> Screening -> Interview -> Selected -> Joined) mixing 2
          real, already-fetched datasets -- see recruitmentPipelineData's own
          comment above for exactly how each stage is computed. This is the
          page's one large/bold chart (CategoryBarChart's `size="lg"`), per
          the redesign's "large and visual" spec for this section.
          Recruitment Trend (a monthly "Joined" line chart) is deliberately
          NOT built here: that time-series data isn't fetched anywhere on
          this page and can't be derived without a new backend endpoint or
          fabricating numbers, both out of scope for this pass -- a
          deliberate scope decision, not an oversight. */}
      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-sm">Recruitment pipeline</CardTitle>
          <p className="text-[10px] font-normal text-muted-foreground">
            Requested/Approved/Published count vacancy requests; Screening onward count individual applications --
            different units, shown together as one pipeline view.
          </p>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {recruitmentPipelineIsLoading ? (
            <div role="status" aria-label="Loading recruitment pipeline" className="h-56 animate-pulse rounded bg-muted" />
          ) : recruitmentPipelineIsEmpty ? (
            <EmptyState message="No vacancy requests or applications in this scope yet." />
          ) : (
            <CategoryBarChart
              ariaLabel="Recruitment pipeline"
              data={recruitmentPipelineData}
              color="var(--color-chart-2)"
              size="lg"
            />
          )}
        </CardContent>
      </Card>

      {/* Vacancy Analysis -- client-side rollup of critical_vacancies (the
          VACANCY_RECRUITMENT_REQUIRED-status rows already fetched above), NOT
          every vacancy in the system. "View All" goes to the Sanctioned
          Strength page -- there's no dedicated "all critical vacancies"
          view. */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 p-4 pb-1">
          <CardTitle className="text-sm">Vacancy analysis -- critical vacancies by department</CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link to="/sanctioned-strength">View All</Link>
          </Button>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {isLoading ? (
            <div role="status" aria-label="Loading vacancy analysis" className="h-56 animate-pulse rounded bg-muted" />
          ) : departmentVacancyTop6.length === 0 ? (
            <EmptyState message="No critical vacancies right now -- nothing urgently understaffed." />
          ) : (
            <CategoryBarChart
              ariaLabel="Critical vacancies by department"
              data={departmentVacancyTop6}
              color="var(--color-chart-4)"
              size="lg"
              testId="critical-vacancies-department-chart"
            />
          )}
        </CardContent>
      </Card>

      {/* Secondary analytics row -- campus-wise hiring (left, now an
          aggregate donut -- see CampusHiringChart.tsx) and a compact "Recent
          Activity" teaser feed (right) combining recent joins/resignations.
          The full Recent joins/Recent resignations tables further down stay
          the detailed view. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs">Campus-wise hiring</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {isLoading ? (
              <div role="status" aria-label="Loading campus-wise hiring" className="h-24 animate-pulse rounded bg-muted" />
            ) : !data || campusWiseHiring.length === 0 ? (
              <EmptyState message="No hires recorded in this scope yet." />
            ) : (
              <CampusHiringChart data={campusWiseHiring} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 p-3 pb-1">
            <CardTitle className="text-xs">Recent activity</CardTitle>
            {/* Anchors to the full "Recent joins"/"Recent resignations"
                tables further down this same page -- 2 of this teaser feed's
                4 event types (the other 2, vacancy requested/approved, have
                no equivalent full-detail table on this page; see
                RecentActivityFeed's own doc comment for why "candidate
                selected" is the one event type still not included), so no
                separate route is needed. */}
            <Button variant="outline" size="sm" asChild>
              <a href="#recent-joins">View All</a>
            </Button>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <RecentActivityFeed
              joins={recentJoins}
              resignations={recentResignations}
              vacancyRequested={vacancyRequestedActivity}
              vacancyApproved={vacancyApprovedActivity}
              isLoading={isLoading || isVacancyRequestsLoading}
            />
          </CardContent>
        </Card>
      </div>

      {/* Critical vacancies -- VACANCY_RECRUITMENT_REQUIRED-status rows
          surfaced from the Sanctioned Strength views (see
          app/services/reporting.py::_critical_vacancy_rows). An empty list
          here is a genuinely good sign, not a loading/error state -- worded
          accordingly rather than the generic "No results found." Rows at
          this result set's single highest vacancy_count get a subtle
          red-tinted highlight (client-side relative signal, not a
          fabricated "priority" field) -- and each row now has a "View"
          action to the Sanctioned Strength page (no per-row detail endpoint
          exists for a critical-vacancy row specifically). Priority (High/
          Medium/Low) is a client-side bucketing of this same result set's
          own vacancy_count values into thirds -- see
          computeCriticalVacancyPriorities' own comment above for the exact
          ranking/tie-break rule; it is NOT a fetched field. Status is a
          constant "Open" on every row -- also not a fetched field, but
          genuinely true by construction: critical_vacancies only ever
          contains currently-open/understaffed rows in the first place. */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 p-3 pb-1">
          <CardTitle className="text-xs">Critical vacancies</CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link to="/sanctioned-strength">View All</Link>
          </Button>
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
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">View</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableEmpty colSpan={8} loading />
              ) : criticalVacancies.length === 0 ? (
                <TableEmpty colSpan={8}>No critical vacancies right now -- nothing urgently understaffed.</TableEmpty>
              ) : (
                criticalVacancies.map((row, index) => {
                  const isHighlighted = criticalVacanciesMax > 0 && row.vacancy_count === criticalVacanciesMax;
                  const priority = criticalVacancyPriorities.get(row) ?? "Low";
                  return (
                    <TableRow
                      key={`${row.department}-${row.designation}-${index}`}
                      className={cn(isHighlighted && "border-l-4 border-l-brand-danger bg-brand-danger/5")}
                    >
                      <TableCell className="font-medium text-foreground">{row.department}</TableCell>
                      <TableCell>{row.designation}</TableCell>
                      <TableCell>{row.location ?? "—"}</TableCell>
                      <TableCell>{row.category.replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.vacancy_count}</TableCell>
                      <TableCell>
                        <Badge variant={CRITICAL_VACANCY_PRIORITY_BADGE[priority]}>{priority}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="success">Open</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link to="/sanctioned-strength" className="text-xs font-medium text-primary hover:underline">
                          View
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Recent joins / Recent resignations -- 2 separate cards (per the
          original spec's distinct "D."/"E." sections), each a top-10 list of
          Employee rows already ordered newest-first by the backend. Kept
          exactly as before -- the "Recent Activity" feed above is a compact
          teaser, this is the full detail. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card id="recent-joins">
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
