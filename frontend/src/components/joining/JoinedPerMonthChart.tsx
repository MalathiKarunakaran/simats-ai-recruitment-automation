import { Link, useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { MonthCount } from "@/api/joiningRecords";

/**
 * Joiners per month, last 12 calendar months -- the Talent Pool's monthly
 * chart with one series instead of a stack. Clicking a bar opens the list
 * for that month; each month also has a visually hidden link that shows on
 * focus, because an SVG bar is not keyboard-reachable.
 */
interface JoinedPerMonthChartProps {
  data: MonthCount[];
  undated: number;
  monthHref: (month: string) => string;
  undatedHref: string;
}

interface Row extends MonthCount {
  shortMonth: string;
  longMonth: string;
}

function toRows(data: MonthCount[]): Row[] {
  return data.map((point) => {
    const [year, month] = point.month.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    return {
      ...point,
      shortMonth: date.toLocaleDateString("en-IN", { month: "short" }),
      longMonth: date.toLocaleDateString("en-IN", { month: "short", year: "numeric" }),
    };
  });
}

function MonthTooltip({ active, payload }: { active?: boolean; payload?: { payload?: Row }[] }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div className="rounded-md border border-border bg-card px-2 py-1.5 text-[11px] text-card-foreground shadow-lg">
      {row.longMonth}: {row.count} joined
    </div>
  );
}

export function JoinedPerMonthChart({ data, undated, monthHref, undatedHref }: JoinedPerMonthChartProps) {
  const navigate = useNavigate();
  const rows = toRows(data);
  const openMonth = (_: unknown, index: number) => {
    const row = rows[index];
    if (row) navigate(monthHref(row.month));
  };

  return (
    <div className="space-y-2">
      <div
        data-testid="joined-per-month-chart"
        aria-label="Joiners per month over the last 12 months"
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
            <Bar
              dataKey="count"
              fill="var(--color-chart-1)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
              cursor="pointer"
              onClick={openMonth}
            >
              <LabelList dataKey="count" position="top" className="fill-foreground text-[10px] tabular-nums" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <ul aria-label="Joiners by month" className="flex flex-wrap gap-1">
        {rows.map((row) => (
          <li key={row.month}>
            <Link
              to={monthHref(row.month)}
              className="sr-only rounded-sm px-1.5 py-0.5 text-[11px] underline focus:not-sr-only focus-visible:outline-2 focus-visible:outline-ring"
            >
              {row.longMonth}: {row.count} joined
            </Link>
          </li>
        ))}
      </ul>

      <p className="text-[11px] text-muted-foreground">
        {undated > 0 ? (
          <Link
            to={undatedHref}
            className="rounded-sm text-foreground underline decoration-border underline-offset-2 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            {`${undated.toLocaleString("en-IN")} ${undated === 1 ? "joiner has" : "joiners have"} no readable joining date and ${undated === 1 ? "is" : "are"} not counted here.`}
          </Link>
        ) : null}{" "}
        Dates come from the sheet&apos;s Joined On column.
      </p>
    </div>
  );
}
