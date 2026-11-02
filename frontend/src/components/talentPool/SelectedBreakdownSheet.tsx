import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getSelectedBreakdown } from "@/api/talentPool";
import type { SelectedBreakdownDimension, TalentPoolBreakdownItem, TalentPoolSourceTab } from "@/api/types";
import { filterHref, type MeaningParam } from "@/components/talentPool/filterHref";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * Opens from the Selected tile: who the selected candidates are, charted by
 * department, college, state, country and gender. These columns are often
 * unfilled in the sheets, so every chart says how many rows it covers rather
 * than letting a handful of values pass for the whole picture. Clicking a bar
 * lists those candidates in the register.
 *
 * Opening focuses the panel itself, without scrolling. Left to itself the
 * dialog focuses the first focusable thing inside, which can sit below the fold
 * and open the panel scrolled down, so a click lands on a different bar than
 * the one aimed at. The charts' own keyboard layer is off for the same reason;
 * the hidden links are how a keyboard reaches a bar.
 */

const ROW_HEIGHT = 26;
// By name, not rank, so a colour keeps its meaning if the larger share changes.
const SHARE_COLORS: Record<string, string> = { Male: "var(--color-chart-1)", Female: "var(--color-chart-2)" };
const OTHER_SHARE_COLOR = "var(--color-chart-4)";

interface SelectedBreakdownSheetProps {
  open: boolean;
  tab: TalentPoolSourceTab;
  deptMode: "group" | "raw";
  currentParams: URLSearchParams;
  onClose: () => void;
}

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** SVG bars are not keyboard-reachable, so each bar also has a real link that
 * stays hidden until focused (same as the monthly chart). */
function BarLinks({ items, hrefFor }: { items: TalentPoolBreakdownItem[]; hrefFor: (label: string) => string }) {
  return (
    <ul className="flex flex-wrap gap-1">
      {items.map((item) => (
        <li key={item.label}>
          <Link
            to={hrefFor(item.label)}
            className="sr-only rounded-sm px-1.5 py-0.5 text-[11px] underline focus:not-sr-only focus-visible:outline-2 focus-visible:outline-ring"
          >
            {item.label}: {item.count}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function BarTooltip({ active, payload, recorded }: { active?: boolean; payload?: { payload?: TalentPoolBreakdownItem }[]; recorded: number }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div className="rounded-md border border-border bg-card px-2 py-1.5 text-[11px] text-card-foreground shadow-lg">
      {row.label}: {row.count} ({percent(row.count, recorded)}% of those recorded)
    </div>
  );
}

function RankedBars({ dimension, hrefFor }: { dimension: SelectedBreakdownDimension; hrefFor: (label: string) => string }) {
  const navigate = useNavigate();
  const { items } = dimension;
  const height = items.length * ROW_HEIGHT + 8;
  return (
    <>
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 400, height }}>
          <BarChart accessibilityLayer={false} data={items} layout="vertical" margin={{ top: 4, right: 32, bottom: 4, left: 0 }}>
            <XAxis type="number" hide domain={[0, "dataMax"]} />
            <YAxis
              type="category"
              dataKey="label"
              width={124}
              interval={0}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--color-foreground)" }}
            />
            <Tooltip cursor={{ fill: "var(--color-muted)", opacity: 0.4 }} content={<BarTooltip recorded={dimension.recorded} />} />
            <Bar
              dataKey="count"
              fill="var(--color-chart-1)"
              barSize={14}
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
              cursor="pointer"
              onClick={(_: unknown, index: number) => {
                const row = items[index];
                if (row) navigate(hrefFor(row.label));
              }}
            >
              <LabelList dataKey="count" position="right" className="fill-foreground text-[11px] tabular-nums" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <BarLinks items={items} hrefFor={hrefFor} />
    </>
  );
}

/** Part of a whole: one bar split by share, each part named with its number. */
function ShareBar({ dimension, hrefFor }: { dimension: SelectedBreakdownDimension; hrefFor: (label: string) => string }) {
  const { items, recorded } = dimension;
  const color = (label: string) => SHARE_COLORS[label] ?? OTHER_SHARE_COLOR;
  return (
    <div className="space-y-2">
      <div className="flex h-6 gap-0.5" aria-hidden="true">
        {items.map((item) => (
          <Link
            key={item.label}
            to={hrefFor(item.label)}
            tabIndex={-1}
            title={`${item.label}: ${item.count}`}
            className="min-w-1 first:rounded-l last:rounded-r"
            style={{ flexGrow: item.count, flexBasis: 0, background: color(item.label) }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {items.map((item) => (
          <li key={item.label}>
            <Link to={hrefFor(item.label)} className="inline-flex items-center gap-1.5 rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring">
              <span className="h-2 w-2 rounded-sm" style={{ background: color(item.label) }} aria-hidden="true" />
              {item.label}: {item.count}
              <span className="text-muted-foreground">({percent(item.count, recorded)}%)</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SelectedBreakdownSheet({ open, tab, deptMode, currentParams, onClose }: SelectedBreakdownSheetProps) {
  const includeInactive = currentParams.get("include_inactive") === "true";
  const query = useQuery({
    queryKey: ["talent-pool", "selected-breakdown", tab, deptMode, includeInactive],
    queryFn: () => getSelectedBreakdown(tab, deptMode, includeInactive),
    enabled: open,
  });
  const data = query.data;
  const sheetName = tab === "NTS" ? "NTS sheet" : "Final sheet";

  // The panel counts every Selected candidate, so a bar's list must not stay
  // narrowed by a department or search chosen earlier on the page.
  const barParams = new URLSearchParams(currentParams);
  barParams.delete("department");
  barParams.delete("q");

  const hrefFor = (param: MeaningParam | "department") => (label: string) => {
    if (param !== "department") return filterHref(tab, { status: "Selected", [param]: label }, barParams);
    const params = new URLSearchParams(barParams);
    params.set("department", label);
    return filterHref(tab, { status: "Selected" }, params);
  };

  const chart = (
    title: string,
    column: string,
    dimension: SelectedBreakdownDimension,
    param: MeaningParam | "department",
    share = false,
  ) => (
    <Card>
      <CardContent className="space-y-2 p-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-[11px] text-muted-foreground">
            Recorded for {dimension.recorded} of {data?.total ?? 0}
            {dimension.from_resume > 0 ? ` (${dimension.from_resume} from resumes)` : ""}
          </p>
        </div>
        {dimension.items.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Not recorded yet. Fill the {column} column in the {sheetName}.
          </p>
        ) : share ? (
          <ShareBar dimension={dimension} hrefFor={hrefFor(param)} />
        ) : (
          <RankedBars dimension={dimension} hrefFor={hrefFor(param)} />
        )}
      </CardContent>
    </Card>
  );

  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <SheetContent
        className="max-w-5xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus({ preventScroll: true });
        }}
      >
        <SheetHeader>
          <SheetTitle>Selected candidates{data ? `: ${data.total}` : ""}</SheetTitle>
          <SheetDescription>From the {sheetName}. Click a bar to see those candidates.</SheetDescription>
          <Button asChild variant="outline" size="sm" className="self-start">
            <Link to={filterHref(tab, { status: "Selected" }, currentParams)}>See full list</Link>
          </Button>
        </SheetHeader>
        <SheetBody>
          {query.isError ? (
            <div className="space-y-2">
              <p className="text-xs text-brand-danger">
                {query.error instanceof Error ? query.error.message : "Could not load the breakdown"}
              </p>
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                Retry
              </Button>
            </div>
          ) : !data ? (
            <p role="status" className="text-xs text-muted-foreground">
              Loading...
            </p>
          ) : (
            <div className="grid items-start gap-3 lg:grid-cols-2">
              <div className="grid gap-3">
                {chart("Male / Female", "Gender", data.gender, "gender", true)}
                {chart("College", "College", data.college, "college")}
                {chart("Country", "Country", data.country, "country")}
                {chart("State", "State", data.state, "state")}
              </div>
              {chart("Department", tab === "NTS" ? "Department" : "Actual Dept", data.department, "department")}
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
