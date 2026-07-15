import { useQuery } from "@tanstack/react-query";

import { getDashboardKpis } from "@/api/dashboard";
import type { DashboardKpis } from "@/api/types";
import { useCampus } from "@/campus/CampusContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Accent = "blue" | "green" | "orange";

const ACCENT_BORDER: Record<Accent, string> = {
  blue: "border-l-brand-blue",
  green: "border-l-brand-green",
  orange: "border-l-brand-orange",
};

const KPI_CARDS: { key: keyof DashboardKpis; label: string; accent: Accent }[] = [
  { key: "total_applications", label: "Total applications", accent: "blue" },
  { key: "open_positions", label: "Open positions", accent: "blue" },
  { key: "interviews_today", label: "Interviews today", accent: "blue" },
  { key: "joinings_today", label: "Joinings today", accent: "green" },
  { key: "offers_pending", label: "Offers pending", accent: "orange" },
  { key: "average_time_to_hire_days", label: "Avg. time to hire (days)", accent: "blue" },
  { key: "vacancy_closure_rate_pct", label: "Vacancy closure rate (%)", accent: "green" },
];

function formatKpiValue(value: DashboardKpis[keyof DashboardKpis]): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number" || typeof value === "string") return String(value);
  return "—";
}

export function DashboardPage() {
  const { selectedCampusCode } = useCampus();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard-kpis", selectedCampusCode],
    queryFn: () => getDashboardKpis(selectedCampusCode),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading dashboard…</p>;
  }

  if (isError || !data) {
    return <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Failed to load"}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-bold tracking-tight">Executive Dashboard</h1>
        <p className="text-sm text-muted-foreground">{data.scope_note}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {KPI_CARDS.map(({ key, label, accent }) => (
          <Card key={key} className={cn("border-l-4", ACCENT_BORDER[accent])}>
            <CardHeader className="pb-2">
              <CardTitle>{label}</CardTitle>
            </CardHeader>
            <CardContent className="font-display text-3xl font-bold tabular-nums">
              {formatKpiValue(data[key])}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Campus-wise hiring</CardTitle>
        </CardHeader>
        <CardContent>
          {data.campus_wise_hiring.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hires recorded in this scope yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-1.5 font-medium">Campus</th>
                  <th className="py-1.5 font-medium">Hired</th>
                </tr>
              </thead>
              <tbody>
                {data.campus_wise_hiring.map((row) => (
                  <tr key={row.campus_code} className="border-b border-border last:border-0">
                    <td className="py-1.5 font-mono text-xs">{row.campus_code}</td>
                    <td className="py-1.5 font-display font-semibold tabular-nums">{row.hired_count}</td>
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
