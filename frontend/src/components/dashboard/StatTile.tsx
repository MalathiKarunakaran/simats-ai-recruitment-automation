import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type StatAccent = "gold" | "green" | "orange" | "none";

const ACCENT_BORDER: Record<StatAccent, string> = {
  gold: "border-l-brand-gold",
  green: "border-l-brand-green",
  orange: "border-l-brand-orange",
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
}

export function StatTile({ label, value, isLoading = false, accent = "none", zeroCaption }: StatTileProps) {
  const isZero = !isLoading && (value === 0 || value === "0");
  const isEmpty = !isLoading && (value === null || value === undefined);

  return (
    <Card className={cn(accent !== "none" && "border-l-4", ACCENT_BORDER[accent])}>
      <CardHeader className="p-3 pb-1">
        <CardTitle className="text-[11px] leading-tight">{label}</CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {isLoading ? (
          <div
            role="status"
            aria-label={`Loading ${label}`}
            className="h-6 w-12 animate-pulse rounded bg-muted"
          />
        ) : isEmpty ? (
          <span className="font-display text-xl font-bold text-muted-foreground">—</span>
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
