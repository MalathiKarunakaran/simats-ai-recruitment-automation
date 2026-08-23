import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface CategorySummaryCardProps {
  title: string;
  sanctioned: number | undefined;
  working: number | undefined;
  vacancy: number | undefined;
  isLoading: boolean;
  /** Subtle per-category accent (Enterprise HRMS dashboard redesign,
   * 2026-08-23) -- a thin top border, distinct from StatTile's own
   * left-border `accent` scheme since these 3 cards are always shown
   * side-by-side as one row and a *top* stripe reads more like a card-level
   * category tag than a data-signal stripe would. Optional/defaulted so this
   * stays a purely additive prop.
   *
   * "orange" added in the dashboard mockup-comparison follow-up patch
   * (2026-08-23): the final per-category color spec is Teaching=blue,
   * Non-Teaching=green, Housekeeping=orange -- Non-Teaching's DashboardPage
   * call site moved off "purple" (kept here since it's a real,
   * independently useful accent, not dead code) and Housekeeping's moved
   * off "green" onto this new "orange" option. */
  accent?: "blue" | "purple" | "green" | "orange";
}

const ACCENT_BORDER_TOP: Record<NonNullable<CategorySummaryCardProps["accent"]>, string> = {
  blue: "border-t-4 border-t-brand-primary",
  purple: "border-t-4 border-t-brand-purple",
  green: "border-t-4 border-t-brand-success",
  orange: "border-t-4 border-t-brand-warning",
};

/** Same sign-based color decision as DashboardPage.tsx's own `vacancyAccent`
 * (StrengthKpiSummary.tsx keeps its own copy too) -- vacancy can legitimately
 * go negative (net overstaffed), and that sign needs to read as meaningful,
 * not as a rendering glitch, without pulling in the full StatTile/StatAccent
 * machinery for what's just a couple of inline numbers here. */
function vacancyToneClass(value: number | undefined): string {
  if (typeof value !== "number") return "text-foreground";
  if (value < 0) return "text-brand-warning";
  if (value === 0) return "text-brand-success";
  return "text-foreground";
}

/** Filled % = working / sanctioned * 100 -- guarded against divide-by-zero
 * (no sanctioned strength in this category/scope yet) rather than rendering
 * a nonsensical Infinity/NaN. Returns null in that case so the caller can
 * fall back to this page's existing "Not enough data yet" convention. */
export function computeFilledPct(working: number | undefined, sanctioned: number | undefined): number | null {
  if (typeof working !== "number" || typeof sanctioned !== "number" || sanctioned <= 0) return null;
  return (working / sanctioned) * 100;
}

function Stat({ label, value, valueClassName }: { label: string; value: ReactNode; valueClassName?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={cn("font-display text-sm font-semibold tabular-nums", valueClassName)}>{value}</span>
    </div>
  );
}

/**
 * Category Summary card (Executive Dashboard redesign, 2026-08-23) -- one of
 * 3 (Teaching / Non-Teaching / Housekeeping), always shown side by side
 * regardless of the page's own category tab selection, same "always all 3"
 * convention the existing "Category-wise split" card already follows.
 * Deliberately compact/mini-stat styled (not a full StatTile grid) per the
 * redesign's "clean horizontal row of 3 compact cards" spec.
 */
export function CategorySummaryCard({
  title,
  sanctioned,
  working,
  vacancy,
  isLoading,
  accent,
}: CategorySummaryCardProps) {
  const filledPct = computeFilledPct(working, sanctioned);

  return (
    <Card className={accent ? ACCENT_BORDER_TOP[accent] : undefined}>
      <CardHeader className="p-3 pb-1">
        <CardTitle className="text-xs">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {isLoading ? (
          <div
            role="status"
            aria-label={`Loading ${title} category summary`}
            className="h-12 animate-pulse rounded bg-muted"
          />
        ) : (
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Sanctioned" value={sanctioned ?? "—"} />
            <Stat label="Working" value={working ?? "—"} />
            <Stat label="Vacancy" value={vacancy ?? "—"} valueClassName={vacancyToneClass(vacancy)} />
            <Stat label="Filled %" value={filledPct === null ? "Not enough data yet" : `${filledPct.toFixed(1)}%`} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
