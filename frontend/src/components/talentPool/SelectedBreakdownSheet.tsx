import { useQuery } from "@tanstack/react-query";
import { BookUser, Building2, ClipboardList, Globe, GraduationCap, MapPin, Share2, UsersRound, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import { Link } from "react-router-dom";

import { getAllRows, getSelectedRows } from "@/api/talentPool";
import type { TalentPoolSelectedRow, TalentPoolSourceTab } from "@/api/types";
import {
  computeFacets,
  countDistinct,
  countMatching,
  DIMENSION_KEYS,
  filterRows,
  selectedDimensions,
  type Dimension,
  type Facet,
} from "@/components/talentPool/crossFilter";
import { filterHref } from "@/components/talentPool/filterHref";
import { useCrossFilter } from "@/components/talentPool/useCrossFilter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Opens from the Talent Pool tiles, over that tile's candidates:
 * who they are, charted by reference, source, department, college, state,
 * country and gender, with the matching candidates listed below. These columns are often
 * unfilled in the sheets, so every chart says how many rows it covers rather
 * than letting a handful of values pass for the whole picture.
 *
 * Clicking a bar filters the other charts (see crossFilter.ts), all in the
 * browser over rows fetched once. Every chart then shows only the matching
 * data: values left at 0 go, and a chart with picks shows just those, with
 * "Pick more" to bring the others back. "See full list" carries the filters to
 * the register. Each bar is a real button, so a keyboard reaches it directly.
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
  status: "Status",
  reference: "Reference",
  source: "Source",
  gender: "Gender",
  college: "College",
  country: "Country",
  state: "State",
  department: "Dept",
};

/** Each chart keeps its own colour, in light and dark, so a value's bar and the
 * tile above it read as one thing. Hues validated against both card surfaces. */
const LOOKS: Record<Dimension, { icon: LucideIcon; color: string }> = {
  status: { icon: ClipboardList, color: "[--accent:var(--color-chart-3)]" },
  reference: { icon: BookUser, color: "[--accent:var(--color-chart-2)]" },
  source: { icon: Share2, color: "[--accent:var(--color-chart-1)]" },
  gender: { icon: UsersRound, color: "[--accent:var(--color-chart-1)]" },
  college: { icon: GraduationCap, color: "[--accent:#7c3aed] dark:[--accent:#a78bfa]" },
  country: { icon: Globe, color: "[--accent:#65a30d] dark:[--accent:#a3e635]" },
  state: { icon: MapPin, color: "[--accent:#0284c7] dark:[--accent:#22d3ee]" },
  department: { icon: Building2, color: "[--accent:#db2777] dark:[--accent:#f472b6]" },
};

const tint = (percent: number) => `color-mix(in srgb, var(--accent) ${percent}%, transparent)`;

interface SelectedBreakdownSheetProps {
  open: boolean;
  /** Selected candidates, everyone, or the status/eligibility in the URL (a tile's count). */
  scope?: "selected" | "all" | "filtered";
  tab: TalentPoolSourceTab;
  deptMode: "group" | "raw";
  currentParams: URLSearchParams;
  onDeptModeChange: (mode: "group" | "raw") => void;
  /** Writes include_inferred into the URL; the panel reads it back from currentParams. */
  onIncludeInferredChange?: (on: boolean) => void;
  onClose: () => void;
}

interface BarsProps {
  facet: Facet;
  picked: Set<string>;
  onToggle: (label: string, additive: boolean) => void;
  labelWidth?: number;
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

function RankedBars({ facet, picked, onToggle, labelWidth = 92 }: BarsProps) {
  const largest = Math.max(1, ...facet.items.map((item) => item.count));
  return (
    <ul>
      {facet.items.map((item) => {
        const dimmed = isDimmed(item.label, item.count, picked);
        const isPicked = picked.has(item.label);
        return (
          <li key={item.label}>
            <button
              type="button"
              aria-pressed={isPicked}
              aria-label={`${item.label}: ${item.count}`}
              title={`${item.label}: ${item.count} (${percent(item.count, facet.recorded)}% of those recorded)`}
              data-dimmed={dimmed}
              {...clickHandlers(item.label, onToggle)}
              className="grid w-full cursor-pointer items-center gap-2 rounded-md px-1 transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
              style={{
                height: ROW_HEIGHT,
                gridTemplateColumns: `${labelWidth}px minmax(0, 1fr) 28px`,
                background: isPicked ? tint(14) : undefined,
              }}
            >
              <span className={cn("truncate text-left text-[11px]", isPicked ? "font-semibold text-foreground" : "text-foreground/85")}>{item.label}</span>
              <span className="block h-2 overflow-hidden rounded-full" style={{ background: tint(12) }}>
                <span
                  className="block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
                  style={{ width: `${(item.count / largest) * 100}%`, background: "var(--accent)", opacity: dimmed ? DIMMED : 1 }}
                />
              </span>
              <span className={cn("text-right text-[11px] font-medium tabular-nums", dimmed ? "text-muted-foreground" : "text-foreground")}>{item.count}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const RING_RADIUS = 38;

/** Part of a whole: a ring split by share, each part named with its number.
 * The legend holds the keyboard's buttons; the ring is the same again for a mouse. */
function ShareRing({ facet, picked, onToggle }: BarsProps) {
  const color = (label: string) => SHARE_COLORS[label] ?? OTHER_SHARE_COLOR;
  let start = 0;
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-24 w-24 shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="50" cy="50" r={RING_RADIUS} fill="none" stroke="var(--color-muted)" strokeWidth="13" />
          {facet.items.map((item) => {
            const share = facet.recorded > 0 ? (item.count / facet.recorded) * 100 : 0;
            const offset = start;
            start += share;
            if (share === 0) return null;
            return (
              <circle
                key={item.label}
                cx="50"
                cy="50"
                r={RING_RADIUS}
                fill="none"
                pathLength={100}
                stroke={color(item.label)}
                strokeWidth="13"
                strokeDasharray={`${Math.max(share - 0.8, 0.5)} 100`}
                strokeDashoffset={-offset}
                opacity={isDimmed(item.label, item.count, picked) ? DIMMED : 1}
                className="cursor-pointer"
                {...clickHandlers(item.label, onToggle)}
              >
                <title>{`${item.label}: ${item.count}`}</title>
              </circle>
            );
          })}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">{facet.recorded}</span>
      </div>
      <ul className="min-w-0 space-y-1 text-xs">
        {facet.items.map((item) => (
          <li key={item.label}>
            <button
              type="button"
              aria-pressed={picked.has(item.label)}
              data-dimmed={isDimmed(item.label, item.count, picked)}
              {...clickHandlers(item.label, onToggle)}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring",
                picked.has(item.label) && "bg-muted font-semibold",
              )}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
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

/** One headline number, in the colour of the chart it summarises. */
function Tile({ label, value, look }: { label: string; value: number; look: Dimension }) {
  const { icon: Icon, color } = LOOKS[look];
  return (
    <div data-testid={`tile-${look}`} className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2", color)} style={{ background: tint(11) } as CSSProperties}>
      <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: "var(--accent)" }} aria-hidden="true">
        <Icon className="h-4 w-4 text-white dark:text-slate-900" />
      </span>
      <span>
        <span className="block text-lg leading-tight font-semibold tabular-nums">{value}</span>
        <span className="block text-[11px] text-muted-foreground">{label}</span>
      </span>
    </div>
  );
}

const PAGE_SIZE = 25;

const SOURCE_WORDS: Record<string, string> = {
  resume_pincode: "From a PIN code in the resume",
  resume_address: "From the home address in the resume",
  resume_honorific: "From the honorific in the resume",
};

/** A value read from a resume rather than typed in the sheet; null otherwise. */
function inferredNote(value: string | null, source: string | null | undefined, evidence: string | null | undefined, label: string): string | null {
  if (!value || !source || source === "sheet" || source === "unknown") return null;
  const words = source === "resume_field" ? `From the ${label} field in the resume` : (SOURCE_WORDS[source] ?? "Read from the resume");
  return evidence || words;
}

/** Plain for a sheet value; italic with a tooltip when it came from a resume. */
function ValueCell({ value, source, evidence, label, className }: { value: string | null; source?: string | null; evidence?: string | null; label: string; className: string }) {
  const note = inferredNote(value, source, evidence, label);
  return (
    <td className={className}>
      {note ? (
        <i title={note} data-inferred="true">
          {value}
        </i>
      ) : (
        (value ?? "\u2013")
      )}
    </td>
  );
}

/** The candidates behind the charts, right here, one page at a time. */
function CandidateTable({ rows, deptMode, showSource }: { rows: TalentPoolSelectedRow[]; deptMode: "group" | "raw"; showSource: boolean }) {
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => [...rows].sort((a, b) => a.full_name.localeCompare(b.full_name)), [rows]);
  // Fewer matches than the page being looked at: back to the start.
  const lastPage = Math.max(0, Math.ceil(sorted.length / PAGE_SIZE) - 1);
  const shownPage = Math.min(page, lastPage);
  const shown = sorted.slice(shownPage * PAGE_SIZE, (shownPage + 1) * PAGE_SIZE);
  const cell = "px-2 py-1.5 text-left";
  return (
    <Card>
      <CardContent className="space-y-2 p-3" data-testid="candidate-table">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold">Candidates: {sorted.length}</h3>
          {sorted.length > PAGE_SIZE ? (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>
                {shownPage * PAGE_SIZE + 1}&ndash;{Math.min((shownPage + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
              </span>
              <Button variant="outline" size="sm" className="h-7" disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" className="h-7" disabled={shownPage === lastPage} onClick={() => setPage(shownPage + 1)}>
                Next
              </Button>
            </div>
          ) : null}
        </div>
        {sorted.length === 0 ? (
          <p className="text-xs text-muted-foreground">No candidates match this selection.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className={cn(cell, "font-medium")}>Name</th>
                  <th className={cn(cell, "font-medium")}>College</th>
                  <th className={cn(cell, "font-medium")}>Department</th>
                  <th className={cn(cell, "font-medium")}>Gender</th>
                  <th className={cn(cell, "font-medium")}>State</th>
                  <th className={cn(cell, "font-medium")}>Status</th>
                  <th className={cn(cell, "font-medium")}>Reference</th>
                  {showSource ? <th className={cn(cell, "font-medium")}>Source</th> : null}
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 last:border-0">
                    <td className={cn(cell, "font-medium")}>{row.full_name}</td>
                    <td className={cell}>{row.college ?? "\u2013"}</td>
                    <td className={cell}>{(deptMode === "raw" ? row.dept_raw : row.dept_group) ?? "\u2013"}</td>
                    <ValueCell value={row.gender} source={row.gender_source} evidence={row.gender_evidence} label="Gender" className={cell} />
                    <ValueCell value={row.state} source={row.state_source} evidence={row.state_evidence} label="State" className={cell} />
                    <td className={cell}>{row.status}</td>
                    <td className={cell}>{row.reference ?? "\u2013"}</td>
                    {showSource ? <td className={cell}>{row.source ?? "\u2013"}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function SelectedBreakdownSheet({ open, scope = "selected", tab, deptMode, currentParams, onDeptModeChange, onIncludeInferredChange, onClose }: SelectedBreakdownSheetProps) {
  const includeInactive = currentParams.get("include_inactive") === "true";
  const selectedOnly = scope === "selected";
  // On unless the URL says otherwise; the same rule the page uses.
  const includeInferred = currentParams.get("include_inferred") !== "false";
  const query = useQuery({
    // Every other tile narrows the same fetched rows, so only the first waits.
    queryKey: ["talent-pool", "panel-rows", selectedOnly ? "selected" : "all", tab, includeInactive, includeInferred],
    queryFn: () => (selectedOnly ? getSelectedRows(tab, includeInactive, includeInferred) : getAllRows(tab, includeInactive, includeInferred)),
    enabled: open,
  });
  const tileStatuses = useMemo(() => (scope === "filtered" ? currentParams.getAll("status") : []), [scope, currentParams]);
  const tileEligibility = scope === "filtered" ? currentParams.get("eligibility") : null;
  const tileKey = JSON.stringify([tileStatuses, tileEligibility]);
  const rows = useMemo(
    () =>
      query.data?.filter(
        (row) =>
          (tileStatuses.length === 0 || tileStatuses.includes(row.status)) &&
          // The summary calls a blank eligibility "Not set", and so does its link.
          (tileEligibility === null || (row.eligibility?.trim() || "Not set") === tileEligibility),
      ),
    [query.data, tileStatuses, tileEligibility],
  );
  const title = selectedOnly
    ? "Selected candidates"
    : scope === "all"
      ? "All candidates"
      : `${[tileEligibility, ...tileStatuses].filter(Boolean).join(", ")} candidates`;
  // One status has nothing to split; everyone, or several, or an eligibility does.
  const showStatus = !selectedOnly && tileStatuses.length !== 1;
  const sheetName = tab === "NTS" ? "NTS sheet" : "Final sheet";

  const { filters, active, toggle, clearDimension, clearAll } = useCrossFilter();
  // Charts showing their other values, so more can be picked.
  const [pickingMore, setPickingMore] = useState<ReadonlySet<Dimension>>(new Set());
  const setPickMore = (key: Dimension, on: boolean) => {
    setPickingMore((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  // A chart with nothing picked has nothing to add to.
  useEffect(() => {
    setPickingMore((current) => {
      const next = new Set([...current].filter((key) => filters[key].size > 0));
      return next.size === current.size ? current : next;
    });
  }, [filters]);

  // Closing the panel, or the sheet changing under it, starts over.
  useEffect(() => {
    if (!open) clearAll();
  }, [open, clearAll]);
  useEffect(() => {
    clearAll();
  }, [tab, scope, tileKey, clearAll]);
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
      matching: filterRows(rows, filters, dimensions),
      colleges: countDistinct(rows, filters, dimensions, "college"),
      states: countDistinct(rows, filters, dimensions, "state"),
      departments: countDistinct(rows, filters, dimensions, "department"),
    };
  }, [rows, filters, deptMode]);

  const listHref = useMemo(() => {
    // No filter: what the tile always did.
    const fixed = selectedOnly
      ? { status: "Selected" }
      : { status: tileStatuses, eligibility: tileEligibility ?? undefined };
    if (!active) return filterHref(tab, fixed, currentParams);
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
        ...fixed,
        ...(filters.status.size > 0 ? { status: [...filters.status] } : {}),
        source: [...filters.reference],
        data_source: [...filters.source],
        gender: [...filters.gender],
        college: [...filters.college],
        country: [...filters.country],
        state: [...filters.state],
      },
      params,
    );
  }, [active, selectedOnly, tileStatuses, tileEligibility, tab, currentParams, deptMode, filters]);

  const chart = (title: string, column: string, key: Dimension, all: Facet, share = false, labelWidth?: number) => {
    const { icon: Icon, color } = LOOKS[key];
    const picked = filters[key];
    const more = pickingMore.has(key);
    const others = all.items.filter((item) => item.count > 0 && !picked.has(item.label)).length;
    let facet: Facet = { ...all, items: all.items.filter((item) => item.count > 0 || picked.has(item.label)) };
    if (picked.size > 0 && !more) {
      const items = all.items.filter((item) => picked.has(item.label));
      facet = {
        ...all,
        items,
        recorded: items.reduce((sum, item) => sum + item.count, 0),
        fromResume: items.reduce((sum, item) => sum + (all.fromResumeByLabel[item.label] ?? 0), 0),
        base: counted?.filtered ?? all.base,
      };
    }
    // While picking more, a plain click adds, so no key needs holding.
    const onToggle = (label: string, additive: boolean) => toggle(key, label, additive || more);
    return (      <Card className={cn("overflow-hidden border-t-[3px]", color)} style={{ borderTopColor: "var(--accent)" }}>
        <CardContent className="space-y-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <div>
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Icon className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} aria-hidden="true" />
                {title}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Recorded for {facet.recorded} of {facet.base}
                {facet.fromResume > 0 ? ` (${facet.recorded - facet.fromResume} from sheet \u00b7 ${facet.fromResume} inferred)` : ""}
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
          {all.items.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Not recorded yet. Fill the {column} column in the {sheetName}.
            </p>
          ) : facet.items.length === 0 ? (
            <p className="text-xs text-muted-foreground">Not recorded for this selection.</p>
          ) : share ? (
            <ShareRing facet={facet} picked={picked} onToggle={onToggle} />
          ) : (
            <RankedBars facet={facet} picked={picked} labelWidth={labelWidth} onToggle={onToggle} />
          )}
          {picked.size > 0 && others > 0 ? (
            <button
              type="button"
              onClick={() => setPickMore(key, !more)}
              className="cursor-pointer rounded-sm text-[11px] font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              style={{ color: "var(--accent)" }}
            >
              {more ? "Show only selected" : `Pick more (${others})`}
            </button>
          ) : null}
        </CardContent>
      </Card>
    );
  };

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
                {title}
                {rows && counted ? `: ${active ? `${counted.filtered} of ${rows.length}` : rows.length}` : ""}
              </SheetTitle>
              <SheetDescription>From the {sheetName}.</SheetDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to={listHref}>See full list</Link>
              </Button>
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={includeInferred}
                  onCheckedChange={(checked) => onIncludeInferredChange?.(checked)}
                  aria-label="Include inferred values"
                />
                Include inferred values
              </label>
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
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Tile label={selectedOnly ? "Selected" : "Candidates"} value={counted.filtered} look="gender" />
                <Tile label={counted.colleges === 1 ? "College" : "Colleges"} value={counted.colleges} look="college" />
                <Tile label={counted.states === 1 ? "State" : "States"} value={counted.states} look="state" />
                <Tile label={counted.departments === 1 ? "Department" : "Departments"} value={counted.departments} look="department" />
              </div>
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
                    Click a bar to show only that data. Use Pick more, or Ctrl or Cmd + click, to choose several in one chart.
                  </p>
                )}
              </div>
              <div className="grid items-start gap-2 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
                <div className="grid gap-2">
                  {showStatus ? chart("Status", "Status", "status", counted.facets.status) : null}
                  {chart("Male / Female", "Gender", "gender", counted.facets.gender, true)}
                  {chart("Reference", "Reference", "reference", counted.facets.reference)}
                  {tab !== "NTS" ? chart("Source", "Reference", "source", counted.facets.source) : null}
                  {chart("Country", "Country", "country", counted.facets.country)}
                </div>
                <div className="grid gap-2">
                  {chart("College", "College", "college", counted.facets.college)}
                  {chart("State", "State", "state", counted.facets.state)}
                </div>
                {chart("Department", tab === "NTS" ? "Department" : "Actual Dept", "department", counted.facets.department, false, 136)}
              </div>
              <CandidateTable rows={counted.matching} deptMode={deptMode} showSource={tab !== "NTS"} />
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
