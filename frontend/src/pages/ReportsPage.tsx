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
import { GenericReportTable } from "@/components/reports/GenericReportTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: "recruitment-funnel", label: "Recruitment funnel" },
  { value: "campus-role-hiring", label: "Campus × role hiring" },
  { value: "interviews", label: "Interviews" },
  { value: "offers", label: "Offers" },
  { value: "joining", label: "Joining" },
  { value: "vacancies", label: "Vacancies" },
  { value: "time-to-hire", label: "Time to hire" },
];

const ROLE_CATEGORIES = ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"];

const KPI_HEADLINE_LABELS: Record<string, string> = {
  total_applications: "Total applications",
  open_positions: "Open positions",
  interviews_today: "Interviews",
  joinings_today: "Joinings",
  offers_pending: "Offers pending",
  vacancy_closure_rate_pct: "Vacancy closure rate (%)",
};

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
  const [roleCategory, setRoleCategory] = useState<string>("ALL");
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
    queryKey: ["report", reportType, selectedCampusCode, roleCategory, reportDateRange.startDate, reportDateRange.endDate],
    queryFn: () =>
      getReport(reportType, {
        campusCode: selectedCampusCode,
        roleCategory: roleCategory === "ALL" ? null : roleCategory,
        startDate: reportDateRange.startDate,
        endDate: reportDateRange.endDate,
      }),
  });

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
        roleCategory: roleCategory === "ALL" ? null : roleCategory,
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
            <div className="w-56">
              <Select value={roleCategory} onValueChange={setRoleCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All role categories</SelectItem>
                  {ROLE_CATEGORIES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option.replace(/_/g, " ")}
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

          {report ? <p className="text-sm text-muted-foreground">{report.scope_note}</p> : null}

          {reportLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <GenericReportTable rows={report?.rows ?? []} />
          )}
        </CardContent>
      </Card>

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
                {weeklyStatus.teaching_rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No data in this scope yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="py-1.5 pr-4 font-medium">Campus</th>
                        <th className="py-1.5 pr-4 font-medium">Attended</th>
                        <th className="py-1.5 pr-4 font-medium">Selected</th>
                        <th className="py-1.5 pr-4 font-medium">Waiting</th>
                        <th className="py-1.5 pr-4 font-medium">Rejected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeklyStatus.teaching_rows.map((row) => (
                        <tr key={row.group_label} className="border-b border-border last:border-0">
                          <td className="py-1.5 pr-4">{row.group_label}</td>
                          <td className="py-1.5 pr-4">{row.attended}</td>
                          <td className="py-1.5 pr-4">{row.selected}</td>
                          <td className="py-1.5 pr-4">{row.waiting}</td>
                          <td className="py-1.5 pr-4">{row.rejected}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
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
                {weeklyStatus.non_teaching_rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No data in this scope yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="py-1.5 pr-4 font-medium">Department</th>
                        <th className="py-1.5 pr-4 font-medium">Attended</th>
                        <th className="py-1.5 pr-4 font-medium">Selected</th>
                        <th className="py-1.5 pr-4 font-medium">Waiting</th>
                        <th className="py-1.5 pr-4 font-medium">Rejected</th>
                        <th className="py-1.5 pr-4 font-medium">Upcoming Join</th>
                        <th className="py-1.5 pr-4 font-medium">Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeklyStatus.non_teaching_rows.map((row) => (
                        <tr key={row.group_label} className="border-b border-border last:border-0">
                          <td className="py-1.5 pr-4">{row.group_label}</td>
                          <td className="py-1.5 pr-4">{row.attended}</td>
                          <td className="py-1.5 pr-4">{row.selected}</td>
                          <td className="py-1.5 pr-4">{row.waiting}</td>
                          <td className="py-1.5 pr-4">{row.rejected}</td>
                          <td className="py-1.5 pr-4">{row.upcoming_join ?? "—"}</td>
                          <td className="py-1.5 pr-4">{row.joined ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
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
