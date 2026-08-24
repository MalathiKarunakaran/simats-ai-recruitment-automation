import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  downloadAdBriefingExport,
  downloadReportExport,
  downloadWeeklyStatusExport,
  getAdBriefing,
  getReport,
  getWeeklyStatus,
} from "@/api/reports";
import type { ReportType, WeeklyRecruitmentStatusResponse } from "@/api/types";
import { useCampus } from "@/campus/CampusContext";
import { DateRangeControl, type DateRangeValue } from "@/components/dashboard/DateRangeControl";
import { CategoryTabs, type CategoryTabCounts } from "@/components/domain/CategoryTabs";
import { GenericReportTable } from "@/components/reports/GenericReportTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCategoryTabState } from "@/hooks/useCategoryTabState";

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: "recruitment-funnel", label: "Recruitment funnel" },
  { value: "campus-role-hiring", label: "Campus × role hiring" },
  { value: "interviews", label: "Interviews" },
  { value: "offers", label: "Offers" },
  { value: "joining", label: "Joining" },
  { value: "vacancies", label: "Vacancies" },
  { value: "time-to-hire", label: "Time to hire" },
  // Phase E item 32 -- app/services/reporting.py::sanctioned_strength_
  // reconciliation_report, registered in REPORT_BUILDERS alongside the
  // other 7. No new UI needed: this page's report card is already fully
  // generic over `rows: Record<string, string | number>[]` (GenericReportTable
  // just renders whatever columns a report returns), and export/date-range/
  // campus-scope plumbing is shared by every report type.
  { value: "sanctioned-strength-reconciliation", label: "Sanctioned strength reconciliation" },
];

const KPI_HEADLINE_LABELS: Record<string, string> = {
  total_applications: "Total applications",
  open_positions: "Open positions",
  interviews_today: "Interviews",
  joinings_today: "Joinings",
  offers_pending: "Offers pending",
  vacancy_closure_rate_pct: "Vacancy closure rate (%)",
};

const TEACHING_ROWS_COLUMN_COUNT = 5;
const NON_TEACHING_ROWS_COLUMN_COUNT = 7;

const WEEKLY_KPI_TILES: { key: keyof WeeklyRecruitmentStatusResponse; label: string }[] = [
  { key: "total_interviewed", label: "Total Interviewed" },
  { key: "total_selected", label: "Selected" },
  { key: "total_waiting", label: "Waiting List" },
  { key: "total_rejected", label: "Rejected" },
  { key: "total_joined", label: "Joined This Week" },
];

// Same labels/ordering as DashboardPage's ROLE_CATEGORIES, kept as a local
// const rather than a cross-page import (this page's existing pattern).
const JOINED_CATEGORY_LABELS: { key: string; label: string }[] = [
  { key: "TEACHING", label: "Teaching" },
  { key: "NON_TEACHING", label: "Non-Teaching" },
  { key: "HOUSEKEEPING", label: "Housekeeping" },
];

// Mirrors DateRangeControl's internal presetRange("week") date math (not
// exported, so replicated here -- this repo's existing pattern of small
// inline date helpers rather than a shared date-range library).
function mondayOfThisWeek(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysSinceMonday);
  return monday.toISOString().slice(0, 10);
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ReportsPage() {
  const { selectedCampusCode } = useCampus();
  const [reportType, setReportType] = useState<ReportType>("recruitment-funnel");
  // URL-persisted via ?category=... (hooks/useCategoryTabState.ts). Kept
  // independent of the AD Briefing/Weekly Recruitment Status cards below --
  // each of this page's 3 cards already has its own independent date-range
  // state (reportDateRange/briefingDateRange/weeklyDateRange are never
  // shared), so a category filter follows the same per-card-independent
  // pattern rather than one URL param driving all 3 cards at once. (AD
  // Briefing/Weekly Status don't get a category hook at all -- see the
  // comments on their cards below for why.)
  const [categoryTab, setCategoryTab] = useCategoryTabState();
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportingReport, setExportingReport] = useState(false);
  const [exportingBriefing, setExportingBriefing] = useState(false);
  const [exportingWeekly, setExportingWeekly] = useState(false);
  const [briefingDateRange, setBriefingDateRange] = useState<DateRangeValue>({ startDate: null, endDate: null });
  const [reportDateRange, setReportDateRange] = useState<DateRangeValue>({ startDate: null, endDate: null });
  const [weeklyDateRange, setWeeklyDateRange] = useState<DateRangeValue>(() => ({
    startDate: mondayOfThisWeek(),
    endDate: todayIsoDate(),
  }));

  const { data: report, isLoading: reportLoading } = useQuery({
    queryKey: ["report", reportType, selectedCampusCode, categoryTab, reportDateRange.startDate, reportDateRange.endDate],
    queryFn: () =>
      getReport(reportType, {
        campusCode: selectedCampusCode,
        roleCategory: categoryTab === "ALL" ? null : categoryTab,
        startDate: reportDateRange.startDate,
        endDate: reportDateRange.endDate,
      }),
  });

  // Counts shown on the CategoryTabs badges. All 7 report types now return a
  // `role_category` column on every row (backend prerequisite for this
  // phase), but there's no dedicated `category_counts` field on this
  // endpoint the way Vacancy Register/Designation Master have (Phase 3) --
  // adding one is a backend change out of scope for this frontend-only
  // phase. Simpler cheap indicator instead: tally the currently-loaded
  // response's own rows per category. Because the query above is itself
  // server-filtered by categoryTab (same as the Select it replaces), picking
  // a specific tab narrows `report.rows` to just that category, so the
  // *other* tabs' badges read 0 until visited -- a deliberate, documented
  // simplification, not a stale/wrong value.
  const reportCategoryCounts: CategoryTabCounts = {
    all: report?.rows.length ?? 0,
    teaching: (report?.rows ?? []).filter((row) => row.role_category === "TEACHING").length,
    nonTeaching: (report?.rows ?? []).filter((row) => row.role_category === "NON_TEACHING").length,
    housekeeping: (report?.rows ?? []).filter((row) => row.role_category === "HOUSEKEEPING").length,
  };

  const { data: briefing, isLoading: briefingLoading } = useQuery({
    queryKey: ["ad-briefing", selectedCampusCode, briefingDateRange.startDate, briefingDateRange.endDate],
    queryFn: () =>
      getAdBriefing({
        campusCode: selectedCampusCode,
        startDate: briefingDateRange.startDate,
        endDate: briefingDateRange.endDate,
      }),
  });

  const { data: weeklyStatus, isLoading: weeklyStatusLoading } = useQuery({
    queryKey: ["weekly-status", selectedCampusCode, weeklyDateRange.startDate, weeklyDateRange.endDate],
    queryFn: () =>
      getWeeklyStatus({
        campusCode: selectedCampusCode,
        startDate: weeklyDateRange.startDate as string,
        endDate: weeklyDateRange.endDate as string,
      }),
    enabled: Boolean(weeklyDateRange.startDate && weeklyDateRange.endDate),
  });

  async function handleExportReport() {
    setExportError(null);
    setExportingReport(true);
    try {
      await downloadReportExport(reportType, {
        campusCode: selectedCampusCode,
        roleCategory: categoryTab === "ALL" ? null : categoryTab,
        startDate: reportDateRange.startDate,
        endDate: reportDateRange.endDate,
      });
    } catch {
      setExportError("Failed to export report");
    } finally {
      setExportingReport(false);
    }
  }

  async function handleExportBriefing() {
    setExportError(null);
    setExportingBriefing(true);
    try {
      await downloadAdBriefingExport({
        campusCode: selectedCampusCode,
        startDate: briefingDateRange.startDate,
        endDate: briefingDateRange.endDate,
      });
    } catch {
      setExportError("Failed to export AD briefing");
    } finally {
      setExportingBriefing(false);
    }
  }

  async function handleExportWeekly() {
    if (!weeklyDateRange.startDate || !weeklyDateRange.endDate) return;
    setExportError(null);
    setExportingWeekly(true);
    try {
      await downloadWeeklyStatusExport({
        campusCode: selectedCampusCode,
        startDate: weeklyDateRange.startDate,
        endDate: weeklyDateRange.endDate,
      });
    } catch {
      setExportError("Failed to export weekly status");
    } finally {
      setExportingWeekly(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Reports</h1>

      <Card>
        <CardHeader>
          <CardTitle>Report</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-4">
            <div className="w-64">
              <Select value={reportType} onValueChange={(v) => setReportType(v as ReportType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DateRangeControl
              value={reportDateRange}
              onChange={setReportDateRange}
              ariaLabel="Report date range"
            />
            <Button variant="outline" disabled={exportingReport} onClick={() => void handleExportReport()}>
              {exportingReport ? "Exporting…" : "Export as Excel"}
            </Button>
          </div>

          <CategoryTabs value={categoryTab} onValueChange={setCategoryTab} counts={reportCategoryCounts} />

          {report ? <p className="text-sm text-muted-foreground">{report.scope_note}</p> : null}

          {reportLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <GenericReportTable rows={report?.rows ?? []} />
          )}
        </CardContent>
      </Card>

      {
        // NOTE (Phase 6 frontend): this card intentionally has no category
        // control. GET /reports/ad-briefing / build_ad_briefing_summary
        // takes no role_category param at all -- kpi_headline is always
        // computed with role_category=None (see reporting.py:764-766), so
        // there's nothing to filter it by client-side. campus_role_breakdown
        // rows do carry a role_category field and *could* be filtered
        // client-side, but that would only narrow the breakdown table while
        // leaving the KPI tiles above it (and the exported PPTX, which
        // re-queries the same unfiltered summary server-side) unaffected --
        // a half-working, misleading control. Adding real support needs a
        // role_category param threaded through build_ad_briefing_summary and
        // its two router routes, which is a backend change out of scope for
        // this frontend-only phase. Flagged back to the plan rather than
        // guessing at new backend behavior.
      }
      <Card>
        <CardHeader>
          <CardTitle>AD Briefing</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <DateRangeControl
              value={briefingDateRange}
              onChange={setBriefingDateRange}
              ariaLabel="AD Briefing date range"
            />
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={exportingBriefing}
              onClick={() => void handleExportBriefing()}
            >
              {exportingBriefing ? "Exporting…" : "Export as PowerPoint"}
            </Button>
          </div>

          {briefing ? (
            <p className="text-sm text-muted-foreground">
              {briefing.scope_note} — showing: {briefing.period_label}
            </p>
          ) : null}

          {briefingLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : briefing ? (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {Object.entries(KPI_HEADLINE_LABELS).map(([key, label]) => (
                  <div key={key} className="rounded-lg border border-border p-3">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="text-xl font-semibold">{briefing.kpi_headline[key] ?? "—"}</div>
                  </div>
                ))}
              </div>
              <GenericReportTable rows={briefing.campus_role_breakdown} />
            </>
          ) : null}
        </CardContent>
      </Card>

      {
        // NOTE (Phase 6 frontend): this card also has no category control,
        // for a stronger reason than AD Briefing above -- it's not just a
        // missing filter param, the data itself doesn't have the needed
        // granularity. build_weekly_recruitment_status/
        // GET /reports/weekly-status take no role_category param, and
        // WeeklyStatusRow (teaching_rows/non_teaching_rows) carries no
        // role_category field per row at all. non_teaching_rows in
        // particular already merges NON_TEACHING and HOUSEKEEPING into one
        // "NTS" bucket by design (_NTS_ROLE_CATEGORIES, reporting.py:839,
        // "NTS in the source file means both"), with no field distinguishing
        // which sub-category a given row belongs to -- so even a purely
        // client-side filter is impossible today, let alone one that also
        // affects the exported PPTX. Splitting Non-Teaching vs Housekeeping
        // apart would mean redesigning this endpoint's aggregation, a
        // backend change out of scope for this frontend-only phase. Flagged
        // back to the plan rather than guessing at new backend behavior.
      }
      <Card>
        <CardHeader>
          <CardTitle>Weekly Recruitment Status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <DateRangeControl
              value={weeklyDateRange}
              onChange={setWeeklyDateRange}
              ariaLabel="Weekly Recruitment Status date range"
            />
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={exportingWeekly || !weeklyDateRange.startDate || !weeklyDateRange.endDate}
              onClick={() => void handleExportWeekly()}
            >
              {exportingWeekly ? "Exporting…" : "Download PowerPoint"}
            </Button>
          </div>

          {weeklyStatus ? (
            <p className="text-sm text-muted-foreground">
              {weeklyStatus.scope_note} — showing: {weeklyStatus.period_label}
            </p>
          ) : null}

          {weeklyStatusLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : weeklyStatus ? (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                {WEEKLY_KPI_TILES.map(({ key, label }) => (
                  <div key={key} className="rounded-lg border border-border p-3">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="text-xl font-semibold">{weeklyStatus[key] as number}</div>
                  </div>
                ))}
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">Teaching Staff — Campus-wise</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-0 py-1.5 pr-4">Campus</TableHead>
                      <TableHead className="px-0 py-1.5 pr-4">Attended</TableHead>
                      <TableHead className="px-0 py-1.5 pr-4">Selected</TableHead>
                      <TableHead className="px-0 py-1.5 pr-4">Waiting</TableHead>
                      <TableHead className="px-0 py-1.5 pr-4">Rejected</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weeklyStatus.teaching_rows.length === 0 ? (
                      <TableEmpty colSpan={TEACHING_ROWS_COLUMN_COUNT} className="px-0">
                        No data in this scope yet.
                      </TableEmpty>
                    ) : (
                      weeklyStatus.teaching_rows.map((row) => (
                        <TableRow key={row.group_label}>
                          <TableCell className="px-0 py-1.5 pr-4">{row.group_label}</TableCell>
                          <TableCell className="px-0 py-1.5 pr-4">{row.attended}</TableCell>
                          <TableCell className="px-0 py-1.5 pr-4">{row.selected}</TableCell>
                          <TableCell className="px-0 py-1.5 pr-4">{row.waiting}</TableCell>
                          <TableCell className="px-0 py-1.5 pr-4">{row.rejected}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">Joined This Week — Category-wise</h3>
                <div className="grid grid-cols-3 gap-4">
                  {JOINED_CATEGORY_LABELS.map(({ key, label }) => (
                    <div key={key} className="rounded-lg border border-border p-3">
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="text-xl font-semibold">{weeklyStatus.joined_by_category[key] ?? 0}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">Non-Teaching Staff — Position-wise</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-0 py-1.5 pr-4">Department</TableHead>
                      <TableHead className="px-0 py-1.5 pr-4">Attended</TableHead>
                      <TableHead className="px-0 py-1.5 pr-4">Selected</TableHead>
                      <TableHead className="px-0 py-1.5 pr-4">Waiting</TableHead>
                      <TableHead className="px-0 py-1.5 pr-4">Rejected</TableHead>
                      <TableHead className="px-0 py-1.5 pr-4">Upcoming Join</TableHead>
                      <TableHead className="px-0 py-1.5 pr-4">Joined</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weeklyStatus.non_teaching_rows.length === 0 ? (
                      <TableEmpty colSpan={NON_TEACHING_ROWS_COLUMN_COUNT} className="px-0">
                        No data in this scope yet.
                      </TableEmpty>
                    ) : (
                      weeklyStatus.non_teaching_rows.map((row) => (
                        <TableRow key={row.group_label}>
                          <TableCell className="px-0 py-1.5 pr-4">{row.group_label}</TableCell>
                          <TableCell className="px-0 py-1.5 pr-4">{row.attended}</TableCell>
                          <TableCell className="px-0 py-1.5 pr-4">{row.selected}</TableCell>
                          <TableCell className="px-0 py-1.5 pr-4">{row.waiting}</TableCell>
                          <TableCell className="px-0 py-1.5 pr-4">{row.rejected}</TableCell>
                          <TableCell className="px-0 py-1.5 pr-4">{row.upcoming_join ?? "—"}</TableCell>
                          <TableCell className="px-0 py-1.5 pr-4">{row.joined ?? "—"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <p className="text-sm text-muted-foreground">
                Overall selection rate: {weeklyStatus.selection_rate_pct ?? "N/A"}
                {weeklyStatus.selection_rate_pct !== null ? "%" : ""} | Prepared by the Recruitment Office
              </p>
            </>
          ) : null}
        </CardContent>
      </Card>

      {exportError ? <p className="text-sm text-destructive">{exportError}</p> : null}
    </div>
  );
}
