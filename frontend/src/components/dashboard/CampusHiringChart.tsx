import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import type { CampusHiringRow } from "@/api/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface CampusHiringChartProps {
  data: CampusHiringRow[];
}

const CHART_HEIGHT = 160;

// Enterprise HRMS dashboard redesign (2026-08-23) + follow-up patch
// (2026-08-23): this donut now has ONE SLICE PER CAMPUS (value = that
// campus's hired_count + open_count + in_progress_count, its total
// activity) instead of the earlier version's 3 status-aggregate slices
// (Hired/Open/In progress summed across every campus) -- the earlier
// version couldn't answer "which campus is doing the most hiring", which is
// the actual question a per-campus donut should answer. The adjacent
// per-campus table (unchanged) still carries the exact per-status numbers,
// so no real detail is lost. No "View All" link here: there's no dedicated
// full campus-wise-hiring detail page/route in this app (grepped before
// adding this comment) to point one at, and the adjacent table on this same
// card already IS the full per-campus detail, so a link back to this same
// card would be circular.
//
// Only 4 named chart color tokens exist (--chart-1..4) but there can be up
// to 7 campuses (CAMPUS_CODES in api/types.ts), so colors cycle -- a
// deliberate, documented reuse rather than inventing 3 more one-off tokens
// for a single chart.
const SLICE_COLOR_TOKENS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
] as const;

/**
 * Per-campus donut chart -- one slice per `campus_wise_hiring` row, sized by
 * that campus's total activity (hired + open + in-progress). A center label
 * shows the grand total across every campus. A compact per-campus table is
 * kept alongside (this app's established "keep the exact numbers visible"
 * habit) rather than relying on hover tooltips alone. Chart and table sit
 * side by side at a shared fixed height (table scrolls internally past
 * that) so this card's footprint never grows past 7 campus rows.
 */
export function CampusHiringChart({ data }: CampusHiringChartProps) {
  const donutData = data.map((row, index) => ({
    name: row.campus_code,
    value: row.hired_count + row.open_count + row.in_progress_count,
    color: SLICE_COLOR_TOKENS[index % SLICE_COLOR_TOKENS.length],
  }));

  const grandTotal = donutData.reduce((sum, slice) => sum + slice.value, 0);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <div data-testid="campus-hiring-chart" className="lg:col-span-3">
        <div className="relative" style={{ width: "100%", height: CHART_HEIGHT }}>
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 360, height: CHART_HEIGHT }}>
            <PieChart>
              <Tooltip />
              <Pie
                data={donutData}
                dataKey="value"
                nameKey="name"
                innerRadius="55%"
                outerRadius="85%"
                paddingAngle={2}
                isAnimationActive={false}
              >
                {donutData.map((slice) => (
                  <Cell key={slice.name} fill={slice.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          {/* Center label: an absolutely-positioned overlay div (rather than
              recharts' Pie <Label>) matching the chart container's size --
              simpler to keep centered through ResponsiveContainer's own
              resize behavior, and renders identically under jsdom/Vitest. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
          >
            <span className="font-display text-lg font-bold tabular-nums text-foreground">{grandTotal}</span>
            <span className="text-[10px] text-muted-foreground">Total</span>
          </div>
        </div>
        {/* A hand-rolled legend, not recharts' built-in <Legend> -- Pie's
            default legend auto-generation treats the whole donut as ONE
            entry, not one entry per slice, and recharts 3.x's public Legend
            props don't accept an explicit per-slice payload override. One
            entry per campus: colored dot + code + "count (percentage%)". */}
        <ul className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {donutData.map((slice) => {
            const pct = grandTotal > 0 ? (slice.value / grandTotal) * 100 : 0;
            return (
              <li key={slice.name} className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: slice.color }} />
                {slice.name}: {slice.value} ({pct.toFixed(1)}%)
              </li>
            );
          })}
        </ul>
      </div>
      <div className="overflow-y-auto lg:col-span-2" style={{ height: CHART_HEIGHT }}>
        <Table className="text-xs">
          <TableHeader className="bg-transparent">
            <TableRow>
              <TableHead className="px-0 py-1 font-medium">Campus</TableHead>
              <TableHead className="px-0 py-1 font-medium">Hired</TableHead>
              <TableHead className="px-0 py-1 font-medium">Open</TableHead>
              <TableHead className="px-0 py-1 font-medium">In progress</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.campus_code}>
                <TableCell className="px-0 py-1 font-mono">{row.campus_code}</TableCell>
                <TableCell className="px-0 py-1 font-display font-semibold tabular-nums">
                  {row.hired_count}
                </TableCell>
                <TableCell className="px-0 py-1 tabular-nums">{row.open_count}</TableCell>
                <TableCell className="px-0 py-1 tabular-nums">{row.in_progress_count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
