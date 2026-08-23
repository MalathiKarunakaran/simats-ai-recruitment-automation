import { Info } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type StatAccent = "gold" | "green" | "orange" | "red" | "blue" | "none";

// "gold" is kept as a StatAccent name for call-site backward compatibility
// (DashboardPage picks accents by this string) but now renders the brand's
// secondary teal, since the redesigned palette has no gold accent.
// "red" (dashboard-kpi-additions-frontend, Step 3) is the first tile accent
// to consume --brand-danger -- reserved for the rare KPI that's genuinely
// meant to read as urgent/needs-attention (e.g. DashboardPage's "Urgent
// vacancies" tile), matching this app's fixed color spec (Red = urgent/
// destructive, see index.css's palette comment). Deliberately just the same
// left-border-stripe treatment as the other 3 accents, not a one-off style --
// `hero` (below) remains the only "extra-loud" treatment on this page, and
// it's reserved for exactly one tile by its own contract, so a tile is never
// both hero and red.
// "blue" (Executive Dashboard redesign, 2026-08-23) -- the app's fixed color
// spec's "normal/neutral" tone (index.css's --brand-primary, already used
// everywhere else for primary actions/focus rings), added for KPI tiles that
// are neither a success/warning/danger signal, just a normal headcount/count
// figure (e.g. "Total Sanctioned", "Active Recruitment"). No existing call
// site used a "blue" accent before this addition, so this is purely additive.
const ACCENT_BORDER: Record<StatAccent, string> = {
  gold: "border-l-brand-secondary",
  green: "border-l-brand-success",
  orange: "border-l-brand-warning",
  red: "border-l-brand-danger",
  blue: "border-l-primary",
  none: "",
};

interface StatTileProps {
  label: string;
  value: number | string | null | undefined;
  isLoading?: boolean;
  accent?: StatAccent;
  /** Shown under the number only when the (loaded) value is exactly zero --
   * distinguishes "confirmed zero" from "still loading" or "no data at all". */
  zeroCaption?: string;
  /** Precise definition of what this KPI counts -- shown on hover/focus of a
   * small info icon next to the label (CLAUDE.md B2: a card must document
   * its own definition, not leave the viewer to guess whether it's counting
   * posts or requests). Plain CSS hover/focus-within, not a Radix Tooltip --
   * this repo has no @radix-ui/react-tooltip dependency and one wasn't worth
   * adding for a single info bubble ("no new UI framework" per the ticket's
   * own constraints). */
  tooltip?: string;
  /** UI redesign Phase 2: marks this tile as the page's ONE hero KPI --
   * consumes `--brand-signature-gradient` (index.css) as a thin ring around
   * the card plus a subtle corner glow, mirroring the sidebar logo mark's
   * use of the same token ("one signature, spent in one place" -- see the
   * token's own docstring in index.css). Optional and defaulted to false so
   * every existing call site (VacancyRequestsListPage, StrengthKpiSummary,
   * DashboardPage's other 8 tiles) renders exactly as before with no prop
   * change required. Purely decorative: never affects content layout. */
  hero?: boolean;
  /** "default" (unchanged) renders this tile's original full-size Card
   * layout -- every existing call site (StrengthKpiSummary,
   * VacancyRequestsListPage, DashboardPage's own primary KPI row) keeps that
   * look with no prop change required. "compact" (Executive Dashboard
   * redesign, 2026-08-23) shrinks the padding/type scale for DashboardPage's
   * secondary stat strip -- 7 lower-priority metrics deliberately
   * de-emphasized below the 6 primary KPI tiles -- while keeping the exact
   * same Card structure/classes (`rounded-xl`, the left accent stripe, hero
   * ring) so every existing accent/tooltip/zero-caption/hero behavior and
   * its tests keep working unchanged, just at a smaller footprint. */
  size?: "default" | "compact";
}

export function StatTile({
  label,
  value,
  isLoading = false,
  accent = "none",
  zeroCaption,
  tooltip,
  hero = false,
  size = "default",
}: StatTileProps) {
  const isZero = !isLoading && (value === 0 || value === "0");
  const isEmpty = !isLoading && (value === null || value === undefined);
  const isCompact = size === "compact";

  const tile = (
    <Card
      data-hero={hero ? "true" : undefined}
      className={cn(
        "relative overflow-hidden",
        // The gradient ring wrapper below already supplies the hero card's
        // outer edge, so the usual left-accent stripe and default gray
        // border are skipped entirely for hero (rather than layered
        // underneath) -- avoids two competing `border-*` utilities landing
        // on the same element with no defined precedence between them.
        !hero && accent !== "none" && "border-l-4",
        !hero && ACCENT_BORDER[accent],
        hero && "border-transparent",
        // Compact tiles don't need the default hover-lift affordance of a
        // full dashboard card -- they read as small inline stats/chips, not
        // clickable-feeling panels.
        isCompact && "hover:translate-y-0 hover:shadow-[var(--shadow-card)]",
      )}
    >
      {hero ? (
        // Decorative corner glow: a blurred, low-opacity smear of the same
        // signature gradient, clipped by the card's own `overflow-hidden`
        // and taken out of layout flow entirely so it can never nudge the
        // label/value beneath it (constraint: "must not affect the tile's
        // actual content layout/spacing").
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-6 -right-6 h-20 w-20 rounded-full opacity-[0.18] blur-2xl"
          style={{ background: "var(--brand-signature-gradient)" }}
        />
      ) : null}
      <CardHeader className={cn("relative flex flex-row items-center gap-1", isCompact ? "p-2 pb-0.5" : "p-3 pb-1")}>
        <CardTitle className={cn("leading-tight", isCompact ? "text-[10px]" : "text-[11px]")}>{label}</CardTitle>
        {tooltip ? (
          <span tabIndex={0} className="group relative inline-flex shrink-0 outline-none">
            <Info className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">{tooltip}</span>
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-48 -translate-x-1/2 rounded-md border border-border bg-card px-2 py-1.5 text-[10px] leading-snug text-card-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus:opacity-100"
            >
              {tooltip}
            </span>
          </span>
        ) : null}
      </CardHeader>
      <CardContent className={cn("relative", isCompact ? "p-2 pt-0" : "p-3 pt-0")}>
        {isLoading ? (
          <div
            role="status"
            aria-label={`Loading ${label}`}
            className={cn("animate-pulse rounded bg-muted", isCompact ? "h-4 w-10" : "h-6 w-12")}
          />
        ) : isEmpty ? (
          // "Not enough data yet" (not a bare "—") -- an em-dash alone reads
          // as an error or a missing value, not "there's genuinely nothing
          // to compute this from yet" (CLAUDE.md B7).
          <span className="text-xs font-medium text-muted-foreground">Not enough data yet</span>
        ) : (
          <>
            <span className={cn("font-display font-bold tabular-nums", isCompact ? "text-sm" : "text-xl")}>
              {value}
            </span>
            {isZero && zeroCaption ? <p className="mt-0.5 text-[10px] text-muted-foreground">{zeroCaption}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );

  if (!hero) return tile;

  // Gradient-ring technique: an outer padded wrapper painted with the
  // signature gradient, with the card sitting flush inside it -- the same
  // "padding = ring thickness" trick as the sidebar logo mark
  // (AppShell.tsx), adapted from a circle to this card's own rounded-rect
  // radius (--radius-card, index.css) so the ring traces the card's actual
  // corners instead of a fixed pill/circle shape. Chosen over the mockup's
  // `::before` + `mask-composite: exclude` approach because it stays plain
  // Tailwind/inline-style (no extra global CSS rule needed for one call
  // site) and composes cleanly with Card's own hover lift/shadow transition.
  return (
    <div
      className="rounded-[var(--radius-card)] p-[2px]"
      style={{ background: "var(--brand-signature-gradient)" }}
    >
      {tile}
    </div>
  );
}
