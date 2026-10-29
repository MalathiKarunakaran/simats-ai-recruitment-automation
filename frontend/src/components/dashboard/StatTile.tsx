import { Info, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type StatAccent = "gold" | "green" | "orange" | "red" | "blue" | "none";

// Enterprise HRMS dashboard redesign (2026-08-23) -- colored icon-chip
// treatment, additive to (not a replacement for) the left-border accent
// stripe above. Deliberately its own small palette rather than reusing
// StatAccent 1:1 -- "purple" (the new --brand-purple analytics accent) has no
// equivalent border accent today, and not every accent maps 1:1 to an icon
// tone the way the brief describes ("blue=neutral, green=success,
// purple=analytics, orange=warning, red=urgent").
export type StatIconColor = "blue" | "green" | "purple" | "orange" | "red";

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
//
// Key-screens redesign (2026-10-29, approved mock-up): a tile is now a plain
// white card -- label, a large number, an optional caption -- and the accent
// colours the NUMBER instead of a left-border stripe. The icon chip and the
// hero gradient ring are no longer drawn; `icon`, `iconColor` and `hero` are
// still accepted so no call site has to change, and `data-hero` still marks
// the hero tile for tests.
const ACCENT_TEXT: Record<StatAccent, string> = {
  gold: "text-foreground",
  green: "text-brand-success",
  orange: "text-brand-warning",
  red: "text-brand-danger",
  blue: "text-primary",
  none: "text-foreground",
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
  /** Optional colored icon chip rendered at the top-right of the tile's
   * header (Enterprise HRMS dashboard redesign, 2026-08-23) -- purely
   * additive: every pre-existing `<StatTile>` call site across the app
   * (VacancyRequestsListPage, StrengthKpiSummary, this page's own tiles that
   * don't pass one) omits this prop and renders exactly as before, no icon
   * chip at all. */
  icon?: LucideIcon;
  /** Tone for the icon chip above -- defaults to "blue" when `icon` is set
   * without an explicit color. Independent of `accent` (the left-border
   * stripe) on purpose: a tile can have a blue border but a purple
   * "analytics" icon, or vice versa, per the redesign's own per-metric color
   * choices. */
  iconColor?: StatIconColor;
  /** Always-visible line under the number (Talent Pool, 2026-10-23) --
   * e.g. "in the Final sheet", "9% of interviewed", "+3 at thesis / viva
   * stage". Distinct from `zeroCaption`, which deliberately shows ONLY when
   * the value is exactly zero; these sub-lines are part of the metric's
   * meaning and must show at every value. Purely additive: no existing call
   * site passes one, and when it is absent the zeroCaption behaviour below
   * is unchanged. */
  subLine?: string;
  /** Makes the whole tile a link to the records behind the number
   * (2026-08-30). Purely additive: every existing call site omits it and
   * renders exactly as before, as a non-interactive tile. Rendered as a real
   * anchor via react-router's Link rather than an onClick div, so the
   * destination is visible on hover, keyboard-reachable, and openable in a
   * new tab -- all of which a click handler on a div silently loses. */
  to?: string;
}

export function StatTile({
  label,
  value,
  isLoading = false,
  accent = "none",
  zeroCaption,
  subLine,
  tooltip,
  hero = false,
  size = "default",
  to,
}: StatTileProps) {
  const isZero = !isLoading && (value === 0 || value === "0");
  const isEmpty = !isLoading && (value === null || value === undefined);
  const isCompact = size === "compact";

  const tile = (
    <Card
      data-hero={hero ? "true" : undefined}
      className={cn(
        "relative h-full overflow-hidden",
        // Compact tiles don't need the default hover-lift affordance of a
        // full dashboard card -- they read as small inline stats/chips, not
        // clickable-feeling panels.
        isCompact && "hover:translate-y-0 hover:shadow-[var(--shadow-card)]",
      )}
    >
      <CardHeader className={cn("relative flex flex-row items-center gap-1", isCompact ? "p-3 pb-0.5" : "px-5 pt-4 pb-1")}>
        <CardTitle
          className={cn("leading-tight font-normal text-muted-foreground", isCompact ? "text-[11px]" : "text-[13px]")}
        >
          {label}
        </CardTitle>
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
      <CardContent className={cn("relative", isCompact ? "p-3 pt-0" : "px-5 pt-0 pb-4")}>
        {isLoading ? (
          <div
            role="status"
            aria-label={`Loading ${label}`}
            className={cn("animate-pulse rounded bg-muted", isCompact ? "h-5 w-10" : "h-8 w-16")}
          />
        ) : isEmpty ? (
          // "Not enough data yet" (not a bare "—") -- an em-dash alone reads
          // as an error or a missing value, not "there's genuinely nothing
          // to compute this from yet" (CLAUDE.md B7).
          <span className="text-xs font-medium text-muted-foreground">Not enough data yet</span>
        ) : (
          <>
            <span
              className={cn(
                "font-display font-extrabold tabular-nums",
                ACCENT_TEXT[accent],
                isCompact ? "text-lg" : "text-[28px] leading-tight",
              )}
            >
              {value}
            </span>
            {subLine ? (
              <p className="mt-1 text-xs text-muted-foreground">{subLine}</p>
            ) : isZero && zeroCaption ? (
              <p className="mt-1 text-xs text-muted-foreground">{zeroCaption}</p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );

  return to ? (
    <Link to={to} className="block h-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      {tile}
    </Link>
  ) : (
    tile
  );
}
