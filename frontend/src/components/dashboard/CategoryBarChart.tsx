import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";

export interface CategoryBarChartDatum {
  label: string;
  value: number;
  /** Opaque id carried alongside the label for drill-down (2026-08-30).
   * The LABEL is a human-readable name and must never be used as a filter
   * value -- two departments can share a name across campuses. */
  key?: string;
}

interface CategoryBarChartProps {
  data: CategoryBarChartDatum[];
  ariaLabel: string;
  /** Series color -- defaults to the app's first chart token. Single-series
   * charts don't need a legend (axis ticks already name each category), so
   * one color is enough. */
  color?: string;
  /** "default" (unchanged) is this component's original compact sizing --
   * every existing call site (source-wise split, rejected-vs-withdrawn) keeps
   * that footprint with no prop change required. "lg" (Executive Dashboard
   * redesign, 2026-08-23) is a bigger/bolder rendering -- taller rows,
   * thicker bars, larger tick/label type -- used for the Recruitment
   * Pipeline and Vacancy Analysis sections, which the redesign calls out as
   * needing to read as visually prominent, not another small widget. */
  size?: "default" | "lg";
  /** Overrides the `data-testid` used for this chart's outer wrapper --
   * defaults to "category-bar-chart" (what every existing test in this repo
   * queries for). DashboardPage's new "Critical vacancies by department"
   * chart passes a distinct id so it doesn't get swept into the existing
   * source-wise/rejected-vs-withdrawn/pipeline-funnel chart-count
   * assertions in DashboardPage.test.tsx. */
  testId?: string;
  /** Makes bars clickable. Receives the datum's `key` when it has one --
   * charts whose data carries no id stay non-interactive rather than
   * emitting a label a caller cannot filter by. */
  onSelect?: (key: string) => void;
}

const ROW_HEIGHT = 22;
const MIN_HEIGHT = 56;
const ROW_HEIGHT_LG = 34;
const MIN_HEIGHT_LG = 120;

/**
 * Horizontal bar chart for a single series of labeled categories (source-wise
 * split, category-wise split, rejected-vs-withdrawn, recruitment pipeline
 * funnel, critical vacancies by department). Value labels are drawn directly
 * at the end of each bar so the exact numbers stay visible without a separate
 * legend or adjacent table.
 */
export function CategoryBarChart({
  data,
  ariaLabel,
  color = "var(--color-chart-1)",
  size = "default",
  testId = "category-bar-chart",
  onSelect,
}: CategoryBarChartProps) {
  const isLg = size === "lg";
  const rowHeight = isLg ? ROW_HEIGHT_LG : ROW_HEIGHT;
  const minHeight = isLg ? MIN_HEIGHT_LG : MIN_HEIGHT;
  const height = Math.max(minHeight, data.length * rowHeight + 24);
  const tickFontSize = isLg ? 13 : 11;

  return (
    <div data-testid={testId} aria-label={ariaLabel} style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 400, height }}>
        <BarChart data={data} layout="vertical" margin={{ top: 2, right: 36, bottom: 2, left: 2 }}>
          <CartesianGrid horizontal={false} stroke="var(--color-border)" />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={isLg ? 128 : 96}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: tickFontSize, fill: "var(--color-muted-foreground)" }}
          />
          <Bar
            dataKey="value"
            fill={color}
            radius={[0, 4, 4, 0]}
            barSize={isLg ? 22 : 13}
            isAnimationActive={false}
            cursor={onSelect ? "pointer" : undefined}
            onClick={
              onSelect
                ? (datum: unknown) => {
                    const key = (datum as CategoryBarChartDatum | undefined)?.key;
                    if (key) onSelect(key);
                  }
                : undefined
            }
          >
            <LabelList
              dataKey="value"
              position="right"
              className={isLg ? "fill-foreground text-sm font-semibold" : "fill-foreground text-xs"}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
