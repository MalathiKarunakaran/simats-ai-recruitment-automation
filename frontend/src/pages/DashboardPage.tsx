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
import { listDepartments } from "@/api/departments";
import { listDesignations } from "@/api/designations";
import { listLocations } from "@/api/locations";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCategoryTabState } from "@/hooks/useCategoryTabState";
import { compareLocationsForDisplay, locationLabel } from "@/lib/locationDisplay";
import { cn } from "@/lib/utils";

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
  /** A short caption shown INSTEAD of a bare 0, for the few tiles where a
   * zero needs explaining. Left undefined the tile just shows 0, per the
   * 2026-08-30 brief: a dashboard full of sentences saying nothing happened
   * reads as broken rather than empty. --
   * some of these tiles have a zero value that means something more specific
   * than "nothing happened here". */
  zeroCaption?: string;
}[] = [
  { key: "total_applications", label: "Total applications", accent: "blue", icon: Users, iconColor: "blue" },
  // Demoted from the primary row on 2026-08-30, not deleted: the brief fixes
  // which six KPIs are primary, and open positions is not one of them, but
  // dropping the metric entirely would lose information the page already had.
  // Counts individual OPEN HiringSlot posts, not vacancy requests, so it is
  // not comparable with "Total requests" on the Vacancy Requests screen.
  {
    key: "open_positions",
    label: "Active Recruitment",
    accent: "blue",
    icon: Briefcase,
    iconColor: "blue",
    tooltip: "Open HiringSlot posts in scope (not requests) -- OPEN status only, RESERVED/FILLED excluded.",
  },
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

// Radix Select cannot hold an empty-string item value, so "no filter" needs a
// sentinel. Kept distinct from any real UUID it shares a Select with.
const ALL_FILTER_VALUE = "ALL";

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
  // Drill-down filters (2026-08-30). "" is the "no filter" value throughout,
  // because Radix Select cannot hold an empty-string SelectItem value -- the
  // ALL sentinel below is the option's value and is translated to null on the
  // way into the query.
  const [departmentId, setDepartmentId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [locationId, setLocationId] = useState("");

  // Single call to /dashboard/kpis serves both the top-line KPI strip (which
  // *does* respect categoryTab, via the role_category param) and the
  // category-wise split card below (whose category_wise_breakdown field the
  // backend deliberately always returns unfiltered, regardless of this same
  // param -- see api/types.ts's CategoryBreakdownRow doc comment). Replaces
  // the old pattern of calling this endpoint 3x more (once per category)
  // just to read total_applications out of each.
  const roleCategoryParam = toRoleCategoryParam(categoryTab);
  // Every filter is part of the query key, so changing any one of them
  // refetches and the whole page -- tiles, charts, category summary -- moves
  // together. Campus/Category/Department/Designation/Location therefore
  // compose rather than override one another.
  const drilldownFilters = {
    departmentId: departmentId || null,
    designationId: designationId || null,
    locationId: locationId || null,
  };
  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "dashboard-kpis",
      selectedCampusCode,
      dateRange.startDate,
      dateRange.endDate,
      roleCategoryParam,
      departmentId,
      designationId,
      locationId,
    ],
    queryFn: () => getDashboardKpis(selectedCampusCode, dateRange, roleCategoryParam, drilldownFilters),
  });

  // Filter-bar option lists. Designations are narrowed by the category tab so
  // the picker cannot offer a Teaching designation while the page is scoped
  // to Housekeeping; locations are relabelled and ordered by the shared
  // helper (see lib/locationDisplay) rather than printing `.name`, which
  // repeats across floors.
  const { data: departmentOptions } = useQuery({ queryKey: ["departments"], queryFn: listDepartments });
  const { data: designationOptions } = useQuery({
    queryKey: ["designations", roleCategoryParam ?? "ALL"],
    queryFn: () => listDesignations(roleCategoryParam ? { category: roleCategoryParam } : {}),
  });
  const { data: locationOptions } = useQuery({ queryKey: ["locations"], queryFn: listLocations });
  const sortedLocationOptions = [...(locationOptions ?? [])].sort(compareLocationsForDisplay);

  const hasActiveDrilldown = Boolean(departmentId || designationId || locationId);
  function clearDrilldownFilters() {
    setDepartmentId("");
    setDesignationId("");
    setLocationId("");
  }

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

  // Vacancy Analysis (2026-08-30) -- served by the backend's vacancy_by_*
  // rollups. This previously aggregated `critical_vacancies` client-side,
  // which is a TOP-10 list: any department outside those ten was silently
  // missing from the chart, and the bars could not be trusted to sum to the
  // Vacancies tile above them. The backend rollups cover every
  // current-effective row and are built from the same resolver as that tile.
  //
  // Already sorted highest-vacancy-first server-side; not re-sorted here.
  const vacancyByDepartment = data?.vacancy_by_department ?? [];
  const vacancyByCampus = data?.vacancy_by_campus ?? [];
  const vacancyByCategory = data?.vacancy_by_category ?? [];
  const departmentVacancyTop6 = vacancyByDepartment
    .slice(0, 6)
    .map((row) => ({ label: row.label, value: row.vacancy }));
  const campusVacancyRows = vacancyByCampus.map((row) => ({ label: row.label, value: row.vacancy }));
  const categoryVacancyRows = vacancyByCategory.map((row) => ({ label: row.label, value: row.vacancy }));

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
  // Pending Requests / Pending Approvals now come from /dashboard/kpis
  // (2026-08-30) instead of being composed client-side from the
  // vacancy-requests list. Two reasons the old composition had to go:
  //
  //  - The two definitions OVERLAPPED. "Pending requests" was
  //    SUBMITTED+DEAN_APPROVED and "Pending approvals" was that same set plus
  //    APPROVED, so every submitted request was counted on both cards. The
  //    backend pair is non-overlapping by construction: SUBMITTED awaits a
  //    Dean, DEAN_APPROVED awaits HR.
  //  - They ignored the campus/category/department filters, so the two cards
  //    sat in a filtered row silently reporting system-wide totals.
  //
  // The vacancy-requests list is still fetched below for the Recent Activity
  // feed, which needs the rows themselves, not a count.
  const pendingRequestsCount = data?.pending_requests_count ?? 0;
  const pendingApprovalsCount = data?.pending_approvals_count ?? 0;

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

      {/* Drill-down filter bar (2026-08-30). Campus comes from the app-wide
          campus switcher and Category from the tabs above, so only the three
          that have no home elsewhere live here. All of them compose: each is
          part of the KPI query key, so selecting Campus=SSE, Category=Teaching
          and Department=CSE narrows every tile and chart together rather than
          the last one winning. */}
      <div data-testid="dashboard-filter-bar" className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-[180px] flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Department</span>
          <Select value={departmentId || ALL_FILTER_VALUE} onValueChange={(v) => setDepartmentId(v === ALL_FILTER_VALUE ? "" : v)}>
            <SelectTrigger aria-label="Department filter">
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>All departments</SelectItem>
              {(departmentOptions ?? []).map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-w-[180px] flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Designation</span>
          <Select value={designationId || ALL_FILTER_VALUE} onValueChange={(v) => setDesignationId(v === ALL_FILTER_VALUE ? "" : v)}>
            <SelectTrigger aria-label="Designation filter">
              <SelectValue placeholder="All designations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>All designations</SelectItem>
              {(designationOptions ?? []).map((designation) => (
                <SelectItem key={designation.id} value={designation.id}>
                  {designation.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-w-[200px] flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Location</span>
          <Select value={locationId || ALL_FILTER_VALUE} onValueChange={(v) => setLocationId(v === ALL_FILTER_VALUE ? "" : v)}>
            <SelectTrigger aria-label="Location filter">
              <SelectValue placeholder="All locations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>All locations</SelectItem>
              {sortedLocationOptions.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {locationLabel(location)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {hasActiveDrilldown ? (
          <Button variant="outline" size="sm" onClick={clearDrilldownFilters}>
            Clear filters
          </Button>
        ) : null}
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
        />
        <StatTile
          label="Working"
          value={isLoading ? undefined : data?.sanctioned_working_total}
          isLoading={isLoading}
          accent="green"
          icon={UserCheck}
          iconColor="green"
          tooltip="Live headcount currently working against those same rows -- Employees for Teaching/Non-Teaching, active Housekeeping Staff for Housekeeping."
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
          label="Recruitment Required"
          value={isLoading ? undefined : data?.recruitment_required_count}
          isLoading={isLoading}
          accent={vacancyAccent(data?.recruitment_required_count, "gold")}
          icon={Briefcase}
          iconColor={vacancyIconColor(data?.recruitment_required_count)}
          // A COUNT OF ROWS, not of people -- deliberately different from the
          // Vacancies tile beside it, which is a signed headcount sum. One
          // designation short by nine staff is 9 there and 1 here.
          tooltip="Sanctioned Strength rows whose vacancy is above zero -- a count of positions needing recruitment, not of people. Compare with Vacancies, which is a headcount."
          hero
        />
        <StatTile
          label="Pending Requests"
          value={isLoading ? undefined : pendingRequestsCount}
          isLoading={isLoading}
          accent="orange"
          icon={ClipboardList}
          iconColor="orange"
          tooltip="Vacancy requests awaiting Dean review -- status SUBMITTED. Does not overlap with Pending Approvals."
        />
        <StatTile
          label="Pending Approvals"
          value={isLoading ? undefined : pendingApprovalsCount}
          isLoading={isLoading}
          accent="orange"
          icon={ClipboardCheck}
          iconColor="orange"
          tooltip="Dean-approved requests awaiting HR's final approval -- status DEAN_APPROVED. Does not overlap with Pending Requests."
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
                zeroCaption={zeroCaption}
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
              <Table className="text-xs" aria-label="Category-wise split">
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-0 py-1">Category</TableHead>
                    <TableHead className="px-0 py-1 text-right">Applications</TableHead>
                    <TableHead className="px-0 py-1 text-right">Open positions</TableHead>
                    <TableHead className="px-0 py-1 text-right">Hires</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categoryBreakdown.map((row) => (
                    <TableRow key={row.role_category}>
                      <TableCell className="px-0 py-1 font-medium text-foreground">
                        {ROLE_CATEGORY_LABELS[row.role_category]}
                      </TableCell>
                      <TableCell className="px-0 py-1 text-right tabular-nums">{row.applications}</TableCell>
                      <TableCell className="px-0 py-1 text-right tabular-nums">{row.open_positions}</TableCell>
                      <TableCell className="px-0 py-1 text-right tabular-nums">{row.hires}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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

      {/* Vacancy Analysis (2026-08-30) -- three views of the SAME
          current-effective sanctioned rows the Vacancies tile is computed
          from, so the bars always reconcile with the card above. This used to
          roll up `critical_vacancies` client-side, which is a top-10 list:
          any department outside those ten was silently absent. */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 p-4 pb-1">
            <CardTitle className="text-sm">Vacancy by department</CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link to="/sanctioned-strength">View All</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {isLoading ? (
              <div role="status" aria-label="Loading vacancy by department" className="h-56 animate-pulse rounded bg-muted" />
            ) : departmentVacancyTop6.length === 0 ? (
              <p className="py-6 text-center text-2xl font-bold tabular-nums text-foreground">0</p>
            ) : (
              <CategoryBarChart
                ariaLabel="Vacancy by department"
                data={departmentVacancyTop6}
                color="var(--color-chart-4)"
                size="lg"
                testId="vacancy-by-department-chart"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-sm">Vacancy by campus</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {isLoading ? (
              <div role="status" aria-label="Loading vacancy by campus" className="h-56 animate-pulse rounded bg-muted" />
            ) : campusVacancyRows.length === 0 ? (
              <p className="py-6 text-center text-2xl font-bold tabular-nums text-foreground">0</p>
            ) : (
              <CategoryBarChart
                ariaLabel="Vacancy by campus"
                data={campusVacancyRows}
                color="var(--color-chart-2)"
                size="lg"
                testId="vacancy-by-campus-chart"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-sm">Vacancy by category</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {isLoading ? (
              <div role="status" aria-label="Loading vacancy by category" className="h-56 animate-pulse rounded bg-muted" />
            ) : categoryVacancyRows.length === 0 ? (
              <p className="py-6 text-center text-2xl font-bold tabular-nums text-foreground">0</p>
            ) : (
              <CategoryBarChart
                ariaLabel="Vacancy by category"
                data={categoryVacancyRows}
                color="var(--color-chart-3)"
                size="lg"
                testId="vacancy-by-category-chart"
              />
            )}
          </CardContent>
        </Card>
      </div>

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
