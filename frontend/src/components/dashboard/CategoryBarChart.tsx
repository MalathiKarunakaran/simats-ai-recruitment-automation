import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";

export interface CategoryBarChartDatum {
  label: string;
  value: number;
}

interface CategoryBarChartProps {
  data: CategoryBarChartDatum[];
  ariaLabel: string;
  /** Series color -- defaults to the app's first chart token. Single-series
   * charts don't need a legend (axis ticks already name each category), so
   * one color is enough. */
  color?: string;
}

const ROW_HEIGHT = 36;
const MIN_HEIGHT = 96;

/**
 * Horizontal bar chart for a single series of labeled categories (source-wise
 * split, category-wise split, rejected-vs-withdrawn). Value labels are drawn
 * directly at the end of each bar so the exact numbers stay visible without a
 * separate legend or adjacent table.
 */
export function CategoryBarChart({ data, ariaLabel, color = "var(--color-chart-1)" }: CategoryBarChartProps) {
  const height = Math.max(MIN_HEIGHT, data.length * ROW_HEIGHT + 24);

  return (
    <div data-testid="category-bar-chart" aria-label={ariaLabel} style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 400, height }}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 32, bottom: 4, left: 4 }}>
          <CartesianGrid horizontal={false} stroke="var(--color-border)" />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={112}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
          />
          <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} barSize={18} isAnimationActive={false}>
            <LabelList dataKey="value" position="right" className="fill-foreground text-xs" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
