import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { downloadAdBriefingExport, downloadReportExport, getAdBriefing, getReport } from "@/api/reports";
import type { ReportType } from "@/api/types";
import { useCampus } from "@/campus/CampusContext";
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
  interviews_today: "Interviews today",
  joinings_today: "Joinings today",
  offers_pending: "Offers pending",
  vacancy_closure_rate_pct: "Vacancy closure rate (%)",
};

export function ReportsPage() {
  const { selectedCampusCode } = useCampus();
  const [reportType, setReportType] = useState<ReportType>("recruitment-funnel");
  const [roleCategory, setRoleCategory] = useState<string>("ALL");
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportingReport, setExportingReport] = useState(false);
  const [exportingBriefing, setExportingBriefing] = useState(false);

  const { data: report, isLoading: reportLoading } = useQuery({
    queryKey: ["report", reportType, selectedCampusCode, roleCategory],
    queryFn: () =>
      getReport(reportType, {
        campusCode: selectedCampusCode,
        roleCategory: roleCategory === "ALL" ? null : roleCategory,
      }),
  });

  const { data: briefing, isLoading: briefingLoading } = useQuery({
    queryKey: ["ad-briefing", selectedCampusCode],
    queryFn: () => getAdBriefing({ campusCode: selectedCampusCode }),
  });

  async function handleExportReport() {
    setExportError(null);
    setExportingReport(true);
    try {
      await downloadReportExport(reportType, {
        campusCode: selectedCampusCode,
        roleCategory: roleCategory === "ALL" ? null : roleCategory,
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
      await downloadAdBriefingExport({ campusCode: selectedCampusCode });
    } catch {
      setExportError("Failed to export AD briefing");
    } finally {
      setExportingBriefing(false);
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
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={exportingBriefing}
            onClick={() => void handleExportBriefing()}
          >
            {exportingBriefing ? "Exporting…" : "Export as PowerPoint"}
          </Button>

          {briefing ? <p className="text-sm text-muted-foreground">{briefing.scope_note}</p> : null}

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

      {exportError ? <p className="text-sm text-destructive">{exportError}</p> : null}
    </div>
  );
}
