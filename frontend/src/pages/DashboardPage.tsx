import { useQuery } from "@tanstack/react-query";

import { getDashboardKpis } from "@/api/dashboard";
import type { DashboardKpis } from "@/api/types";
import { useCampus } from "@/campus/CampusContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const KPI_CARDS: { key: keyof DashboardKpis; label: string }[] = [
  { key: "total_applications", label: "Total applications" },
  { key: "open_positions", label: "Open positions" },
  { key: "interviews_today", label: "Interviews today" },
  { key: "joinings_today", label: "Joinings today" },
  { key: "offers_pending", label: "Offers pending" },
  { key: "average_time_to_hire_days", label: "Avg. time to hire (days)" },
  { key: "vacancy_closure_rate_pct", label: "Vacancy closure rate (%)" },
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
        <h1 className="text-lg font-semibold">Executive Dashboard</h1>
        <p className="text-sm text-muted-foreground">{data.scope_note}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {KPI_CARDS.map(({ key, label }) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle>{label}</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{formatKpiValue(data[key])}</CardContent>
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
                    <td className="py-1.5">{row.campus_code}</td>
                    <td className="py-1.5">{row.hired_count}</td>
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
