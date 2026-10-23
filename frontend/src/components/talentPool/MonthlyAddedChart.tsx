import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { TalentPoolMonthlyPoint, TalentPoolSourceTab } from "@/api/types";

/**
 * Candidates added per month, last 12 calendar months (spec 1.3).
 *
 * "Selected" is a SUBSET of "Added", not a second series beside it, so the
 * bar is a two-part stack -- selected at the base in the darker tone, the
 * rest above it -- whose full height is the month's total. Rendering them
 * side by side would imply two independent counts, and overlaying them with
 * a negative bar gap would make the smaller one hard to read at 400px.
 *
 * The value label therefore reads `added` from the datum rather than the
 * bar's own dataKey: the top segment's own value is the remainder, which is
 * not a number anybody wants to see.
 *
 * The legend is hand-written rather than recharts' own, which would label
 * the series "selected" and "remainder" after the stack's dataKeys.
 */

interface MonthlyAddedChartProps {
  data: TalentPoolMonthlyPoint[];
  /** Entries with no readable date. Reported under the chart, because they
   * are in the total above and deliberately not in any bar. */
  undated: number;
  tab: TalentPoolSourceTab;
}

const ADDED_COLOR = "var(--color-chart-1)";
const SELECTED_COLOR = "var(--color-chart-2)";

interface ChartRow extends TalentPoolMonthlyPoint {
  remainder: number;
  shortMonth: string;
  longMonth: string;
}

function toRows(data: TalentPoolMonthlyPoint[]): ChartRow[] {
  return data.map((point) => {
    const [year, month] = point.month.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    return {
      ...point,
      // Clamped at zero: `selected` can only exceed `added` if the two were
      // counted over different row sets, and a negative segment would draw
      // the bar upside down rather than make that visible.
      remainder: Math.max(0, point.added - point.selected),
      shortMonth: date.toLocaleDateString("en-IN", { month: "short" }),
      longMonth: date.toLocaleDateString("en-IN", { month: "short", year: "numeric" }),
    };
  });
}

interface TooltipPayloadItem {
  payload?: ChartRow;
}

function MonthTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div className="rounded-md border border-border bg-card px-2 py-1.5 text-[11px] text-card-foreground shadow-lg">
      {row.longMonth}: {row.added} added, {row.selected} selected
    </div>
  );
}

export function MonthlyAddedChart({ data, undated, tab }: MonthlyAddedChartProps) {
  const rows = toRows(data);
  const dateSource =
    tab === "TEACHING_FINAL"
      ? "Dates come from Applied Date."
      : "Dates come from Call / Mail Sent Date, or the interview date when that is blank.";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: ADDED_COLOR }} aria-hidden="true" />
          Added
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: SELECTED_COLOR }} aria-hidden="true" />
          Selected
        </span>
      </div>

      <div
        data-testid="talent-pool-monthly-chart"
        aria-label="Candidates added per month over the last 12 months"
        style={{ width: "100%", height: 200 }}
      >
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 400, height: 200 }}>
          <BarChart data={rows} margin={{ top: 18, right: 4, bottom: 2, left: 2 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" />
            <XAxis
              dataKey="shortMonth"
              tickLine={false}
              axisLine={false}
              interval={0}
              tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
            />
            <YAxis hide />
            <Tooltip cursor={{ fill: "var(--color-muted)", opacity: 0.4 }} content={<MonthTooltip />} />
            <Bar dataKey="selected" stackId="month" fill={SELECTED_COLOR} isAnimationActive={false} />
            <Bar dataKey="remainder" stackId="month" fill={ADDED_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {/* Reads `added` from the datum -- this bar's own value is the
                  remainder, which is not a number worth showing. */}
              <LabelList dataKey="added" position="top" className="fill-foreground text-[10px] tabular-nums" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {undated > 0
          ? `${undated.toLocaleString("en-IN")} ${undated === 1 ? "row has" : "rows have"} no readable date and ${undated === 1 ? "is" : "are"} not counted here. `
          : ""}
        {dateSource}
      </p>
    </div>
  );
}
