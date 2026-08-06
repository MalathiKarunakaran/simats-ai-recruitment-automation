import { Info } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type StatAccent = "gold" | "green" | "orange" | "none";

// "gold" is kept as a StatAccent name for call-site backward compatibility
// (DashboardPage picks accents by this string) but now renders the brand's
// secondary teal, since the redesigned palette has no gold accent.
const ACCENT_BORDER: Record<StatAccent, string> = {
  gold: "border-l-brand-secondary",
  green: "border-l-brand-success",
  orange: "border-l-brand-warning",
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
}

export function StatTile({ label, value, isLoading = false, accent = "none", zeroCaption, tooltip }: StatTileProps) {
  const isZero = !isLoading && (value === 0 || value === "0");
  const isEmpty = !isLoading && (value === null || value === undefined);

  return (
    <Card className={cn(accent !== "none" && "border-l-4", ACCENT_BORDER[accent])}>
      <CardHeader className="flex flex-row items-center gap-1 p-3 pb-1">
        <CardTitle className="text-[11px] leading-tight">{label}</CardTitle>
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
      <CardContent className="p-3 pt-0">
        {isLoading ? (
          <div
            role="status"
            aria-label={`Loading ${label}`}
            className="h-6 w-12 animate-pulse rounded bg-muted"
          />
        ) : isEmpty ? (
          // "Not enough data yet" (not a bare "—") -- an em-dash alone reads
          // as an error or a missing value, not "there's genuinely nothing
          // to compute this from yet" (CLAUDE.md B7).
          <span className="text-xs font-medium text-muted-foreground">Not enough data yet</span>
        ) : (
          <>
            <span className="font-display text-xl font-bold tabular-nums">{value}</span>
            {isZero && zeroCaption ? <p className="mt-0.5 text-[10px] text-muted-foreground">{zeroCaption}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
