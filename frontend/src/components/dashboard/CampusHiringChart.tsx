import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { CampusHiringRow } from "@/api/types";

interface CampusHiringChartProps {
  data: CampusHiringRow[];
}

const CHART_HEIGHT = 260;

/**
 * Grouped vertical bar chart -- 3 series (hired/open/in-progress) per campus.
 * Needs a legend since it's more than one series. A compact table is kept
 * alongside the chart (this app's established "keep the exact numbers
 * visible" habit) rather than relying on hover tooltips alone.
 */
export function CampusHiringChart({ data }: CampusHiringChartProps) {
  return (
    <div className="flex flex-col gap-4">
      <div data-testid="campus-hiring-chart" style={{ width: "100%", height: CHART_HEIGHT }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: CHART_HEIGHT }}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" />
            <XAxis
              dataKey="campus_code"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
            />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="hired_count" name="Hired" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="open_count" name="Open" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar
              dataKey="in_progress_count"
              name="In progress"
              fill="var(--color-chart-3)"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-1.5 font-medium">Campus</th>
            <th className="py-1.5 font-medium">Hired</th>
            <th className="py-1.5 font-medium">Open</th>
            <th className="py-1.5 font-medium">In progress</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.campus_code} className="border-b border-border last:border-0">
              <td className="py-1.5 font-mono text-xs">{row.campus_code}</td>
              <td className="py-1.5 font-display font-semibold tabular-nums">{row.hired_count}</td>
              <td className="py-1.5 tabular-nums">{row.open_count}</td>
              <td className="py-1.5 tabular-nums">{row.in_progress_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
