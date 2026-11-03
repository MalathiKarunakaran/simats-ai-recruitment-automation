import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useMemo, type MouseEvent } from "react";
import { Link } from "react-router-dom";

import { getSelectedRows } from "@/api/talentPool";
import type { TalentPoolSourceTab } from "@/api/types";
import {
  computeFacets,
  countMatching,
  DIMENSION_KEYS,
  selectedDimensions,
  type Dimension,
  type Facet,
} from "@/components/talentPool/crossFilter";
import { filterHref } from "@/components/talentPool/filterHref";
import { useCrossFilter } from "@/components/talentPool/useCrossFilter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Opens from the Selected tile: who the selected candidates are, charted by
 * department, college, state, country and gender. These columns are often
 * unfilled in the sheets, so every chart says how many rows it covers rather
 * than letting a handful of values pass for the whole picture.
 *
 * Clicking a bar filters the other charts (see crossFilter.ts), all in the
 * browser over rows fetched once. "See full list" carries the filters to the
 * register. Each bar is a real button, so a keyboard reaches it directly.
 *
 * Opening focuses the panel itself, without scrolling. Left to itself the
 * dialog focuses the first focusable thing inside, which can sit below the fold
 * and open the panel scrolled down, so a click lands on a different bar than
 * the one aimed at.
 */

const ROW_HEIGHT = 20;
const DIMMED = 0.3;
// By name, not rank, so a colour keeps its meaning if the larger share changes.
const SHARE_COLORS: Record<string, string> = { Male: "var(--color-chart-1)", Female: "var(--color-chart-2)" };
const OTHER_SHARE_COLOR = "var(--color-chart-4)";

const CHIP_NAMES: Record<Dimension, string> = {
  gender: "Gender",
  college: "College",
  country: "Country",
  state: "State",
  department: "Dept",
};

interface SelectedBreakdownSheetProps {
  open: boolean;
  tab: TalentPoolSourceTab;
  deptMode: "group" | "raw";
  currentParams: URLSearchParams;
  onDeptModeChange: (mode: "group" | "raw") => void;
  onClose: () => void;
}

interface BarsProps {
  facet: Facet;
  picked: Set<string>;
  onToggle: (label: string, additive: boolean) => void;
}

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** Dim a value that is not picked while its chart has picks, or that has no one left. */
function isDimmed(label: string, count: number, picked: Set<string>): boolean {
  return count === 0 || (picked.size > 0 && !picked.has(label));
}

/** On a Mac, Ctrl + click is a right-click: it fires contextmenu and no click. */
function clickHandlers(label: string, onToggle: BarsProps["onToggle"]) {
  return {
    onClick: (event: MouseEvent) => onToggle(label, event.ctrlKey || event.metaKey),
    onContextMenu: (event: MouseEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
        onToggle(label, true);
      }
    },
  };
}

function RankedBars({ facet, picked, onToggle }: BarsProps) {
  const largest = Math.max(1, ...facet.items.map((item) => item.count));
  return (
    <ul>
      {facet.items.map((item) => {
        const dimmed = isDimmed(item.label, item.count, picked);
        return (
          <li key={item.label}>
            <button
              type="button"
              aria-pressed={picked.has(item.label)}
              aria-label={`${item.label}: ${item.count}`}
              title={`${item.label}: ${item.count} (${percent(item.count, facet.recorded)}% of those recorded)`}
              data-dimmed={dimmed}
              {...clickHandlers(item.label, onToggle)}
              className="grid w-full cursor-pointer grid-cols-[100px_1fr] items-center gap-1.5 rounded-sm hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
              style={{ height: ROW_HEIGHT }}
            >
              <span className="truncate text-right text-[11px] text-foreground">{item.label}</span>
              <span className="flex min-w-0 items-center gap-1">
                <span
                  className="h-2.5 rounded-r"
                  style={{
                    width: `calc((100% - 36px) * ${item.count / largest})`,
                    background: "var(--color-chart-1)",
                    opacity: dimmed ? DIMMED : 1,
                  }}
                />
                <span className={cn("text-[11px] tabular-nums", dimmed ? "text-muted-foreground" : "text-foreground")}>{item.count}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Part of a whole: one bar split by share, each part named with its number.
 * The legend holds the keyboard's buttons; the bar is the same again for a mouse. */
function ShareBar({ facet, picked, onToggle }: BarsProps) {
  const color = (label: string) => SHARE_COLORS[label] ?? OTHER_SHARE_COLOR;
  return (
    <div className="space-y-1.5">
      <div className="flex h-3.5 gap-0.5" aria-hidden="true">
        {facet.items.map((item) => (
          <button
            key={item.label}
            type="button"
            tabIndex={-1}
            title={`${item.label}: ${item.count}`}
            {...clickHandlers(item.label, onToggle)}
            className="min-w-1 cursor-pointer first:rounded-l last:rounded-r"
            style={{
              flexGrow: item.count,
              flexBasis: 0,
              background: color(item.label),
              opacity: isDimmed(item.label, item.count, picked) ? DIMMED : 1,
            }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        {facet.items.map((item) => (
          <li key={item.label}>
            <button
              type="button"
              aria-pressed={picked.has(item.label)}
              data-dimmed={isDimmed(item.label, item.count, picked)}
              {...clickHandlers(item.label, onToggle)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span
                className="h-2 w-2 rounded-sm"
                style={{ background: color(item.label), opacity: isDimmed(item.label, item.count, picked) ? DIMMED : 1 }}
                aria-hidden="true"
              />
              {item.label}: {item.count}
              <span className="text-muted-foreground">({percent(item.count, facet.recorded)}%)</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SelectedBreakdownSheet({ open, tab, deptMode, currentParams, onDeptModeChange, onClose }: SelectedBreakdownSheetProps) {
  const includeInactive = currentParams.get("include_inactive") === "true";
  const query = useQuery({
    queryKey: ["talent-pool", "selected-rows", tab, includeInactive],
    queryFn: () => getSelectedRows(tab, includeInactive),
    enabled: open,
  });
  const rows = query.data;
  const sheetName = tab === "NTS" ? "NTS sheet" : "Final sheet";

  const { filters, active, toggle, clearDimension, clearAll } = useCrossFilter();

  // Closing the panel, or the sheet changing under it, starts over.
  useEffect(() => {
    if (!open) clearAll();
  }, [open, clearAll]);
  useEffect(() => {
    clearAll();
  }, [tab, clearAll]);
  // The two department views have different values, so a pick cannot carry over.
  useEffect(() => {
    clearDimension("department");
  }, [deptMode, clearDimension]);

  const counted = useMemo(() => {
    if (!rows) return null;
    const dimensions = selectedDimensions(deptMode);
    return {
      facets: computeFacets(rows, filters, dimensions),
      filtered: countMatching(rows, filters, dimensions),
    };
  }, [rows, filters, deptMode]);

  const listHref = useMemo(() => {
    // No filter: what the Selected tile always did.
    if (!active) return filterHref(tab, { status: "Selected" }, currentParams);
    // The panel counts every Selected candidate, so its list must not stay
    // narrowed by a department or search chosen earlier on the page.
    const params = new URLSearchParams(currentParams);
    params.delete("department");
    params.delete("q");
    params.set("dept_mode", deptMode);
    filters.department.forEach((label) => params.append("department", label));
    return filterHref(
      tab,
      {
        status: "Selected",
        gender: [...filters.gender],
        college: [...filters.college],
        country: [...filters.country],
        state: [...filters.state],
      },
      params,
    );
  }, [active, tab, currentParams, deptMode, filters]);

  const chart = (title: string, column: string, key: Dimension, facet: Facet, share = false) => (
    <Card>
      <CardContent className="space-y-1.5 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="text-xs font-semibold">{title}</h3>
            <p className="text-[11px] text-muted-foreground">
              Recorded for {facet.recorded} of {facet.base}
              {facet.fromResume > 0 ? ` (${facet.fromResume} from resumes)` : ""}
            </p>
          </div>
          {key === "department" && tab !== "NTS" ? (
            <div role="group" aria-label="Department grouping" className="flex rounded-md border border-border p-0.5">
              {([
                { mode: "group" as const, label: "Grouped" },
                { mode: "raw" as const, label: "As in sheet" },
              ]).map((option) => (
                <button
                  key={option.mode}
                  type="button"
                  aria-pressed={deptMode === option.mode}
                  onClick={() => onDeptModeChange(option.mode)}
                  className={cn(
                    "rounded px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    deptMode === option.mode ? "bg-brand-primary text-white" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {facet.items.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Not recorded yet. Fill the {column} column in the {sheetName}.
          </p>
        ) : share ? (
          <ShareBar facet={facet} picked={filters[key]} onToggle={(label, additive) => toggle(key, label, additive)} />
        ) : (
          <RankedBars facet={facet} picked={filters[key]} onToggle={(label, additive) => toggle(key, label, additive)} />
        )}
      </CardContent>
    </Card>
  );

  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <SheetContent
        className="max-w-6xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus({ preventScroll: true });
        }}
        onEscapeKeyDown={(event) => {
          // Esc takes the filters off first; with none on, it closes as usual.
          if (active) {
            event.preventDefault();
            clearAll();
          }
        }}
      >
        <SheetHeader className="mb-2">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <div>
              <SheetTitle>
                Selected candidates
                {rows && counted ? `: ${active ? `${counted.filtered} of ${rows.length}` : rows.length}` : ""}
              </SheetTitle>
              <SheetDescription>From the {sheetName}.</SheetDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to={listHref}>See full list</Link>
              </Button>
              <Button variant="outline" size="sm" disabled={!active} onClick={clearAll}>
                Clear selection
              </Button>
            </div>
          </div>
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
          ) : !counted ? (
            <p role="status" className="text-xs text-muted-foreground">
              Loading...
            </p>
          ) : (
            <div className="space-y-2">
              {/* Always there, so the charts stay put when the first bar is clicked. */}
              <div className="flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-muted/30 px-2.5 py-1.5" data-testid="selection-box">
                {active ? (
                  <>
                    <span className="text-[11px] font-semibold">Your selection:</span>
                    <ul aria-label="Active filters" className="flex flex-wrap gap-1.5">
                      {DIMENSION_KEYS.filter((key) => filters[key].size > 0).map((key) => (
                        <li key={key}>
                          <button
                            type="button"
                            onClick={() => clearDimension(key)}
                            aria-label={`Remove ${CHIP_NAMES[key]} filter: ${[...filters[key]].join(", ")}`}
                            className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            {CHIP_NAMES[key]}: {[...filters[key]].join(", ")}
                            <X className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Click a bar to filter the other charts. Ctrl or Cmd + click picks several in one chart.
                  </p>
                )}
              </div>
              <div className="grid items-start gap-2 lg:grid-cols-3">
                <div className="grid gap-2">
                  {chart("Male / Female", "Gender", "gender", counted.facets.gender, true)}
                  {chart("College", "College", "college", counted.facets.college)}
                  {chart("Country", "Country", "country", counted.facets.country)}
                </div>
                {chart("State", "State", "state", counted.facets.state)}
                {chart("Department", tab === "NTS" ? "Department" : "Actual Dept", "department", counted.facets.department)}
              </div>
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
