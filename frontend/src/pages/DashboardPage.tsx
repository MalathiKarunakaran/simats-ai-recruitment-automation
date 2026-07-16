import { useQuery } from "@tanstack/react-query";

import { getDashboardKpis } from "@/api/dashboard";
import type { DashboardKpis } from "@/api/types";
import { useCampus } from "@/campus/CampusContext";
import { StatTile, type StatAccent } from "@/components/dashboard/StatTile";
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

export function DashboardPage() {
  const { selectedCampusCode } = useCampus();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard-kpis", selectedCampusCode],
    queryFn: () => getDashboardKpis(selectedCampusCode),
  });

  if (isError) {
    return <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Failed to load"}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-bold tracking-tight">Executive Dashboard</h1>
        <div className="gear-edge mt-2 w-24" />
        <p className="mt-2 text-sm text-muted-foreground">{isLoading ? "Loading…" : data?.scope_note}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
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

      <Card>
        <CardHeader>
          <CardTitle>Campus-wise hiring</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div role="status" aria-label="Loading campus-wise hiring" className="h-24 animate-pulse rounded bg-muted" />
          ) : !data || data.campus_wise_hiring.length === 0 ? (
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
