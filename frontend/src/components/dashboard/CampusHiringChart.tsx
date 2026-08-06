import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { CampusHiringRow } from "@/api/types";

interface CampusHiringChartProps {
  data: CampusHiringRow[];
}

const CHART_HEIGHT = 140;
// A single-campus (or few-campus) scope would otherwise let recharts stretch
// each bar to fill the available category width, rendering as a giant block
// rather than a normal bar (CLAUDE.md B6) -- caps regardless of how few
// categories are in scope.
const MAX_BAR_SIZE = 56;

/**
 * Grouped vertical bar chart -- 3 series (hired/open/in-progress) per campus.
 * Needs a legend since it's more than one series. A compact table is kept
 * alongside the chart (this app's established "keep the exact numbers
 * visible" habit) rather than relying on hover tooltips alone. Chart and
 * table sit side by side at a shared fixed height (table scrolls internally
 * past that) so this card's footprint never grows past 7 campus rows.
 */
export function CampusHiringChart({ data }: CampusHiringChartProps) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <div
        data-testid="campus-hiring-chart"
        className="lg:col-span-3"
        style={{ width: "100%", height: CHART_HEIGHT }}
      >
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 360, height: CHART_HEIGHT }}>
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" />
            <XAxis
              dataKey="campus_code"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={24}
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} height={20} />
            <Bar
              dataKey="hired_count"
              name="Hired"
              fill="var(--color-chart-1)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
              maxBarSize={MAX_BAR_SIZE}
            />
            <Bar
              dataKey="open_count"
              name="Open"
              fill="var(--color-chart-2)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
              maxBarSize={MAX_BAR_SIZE}
            />
            <Bar
              dataKey="in_progress_count"
              name="In progress"
              fill="var(--color-chart-3)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
              maxBarSize={MAX_BAR_SIZE}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-y-auto lg:col-span-2" style={{ height: CHART_HEIGHT }}>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1 font-medium">Campus</th>
              <th className="py-1 font-medium">Hired</th>
              <th className="py-1 font-medium">Open</th>
              <th className="py-1 font-medium">In progress</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.campus_code} className="border-b border-border last:border-0">
                <td className="py-1 font-mono">{row.campus_code}</td>
                <td className="py-1 font-display font-semibold tabular-nums">{row.hired_count}</td>
                <td className="py-1 tabular-nums">{row.open_count}</td>
                <td className="py-1 tabular-nums">{row.in_progress_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
