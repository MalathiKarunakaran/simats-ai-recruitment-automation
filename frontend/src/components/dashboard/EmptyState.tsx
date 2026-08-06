import { cn } from "@/lib/utils";

interface EmptyStateProps {
  message: string;
  className?: string;
}

/**
 * One reusable "nothing here yet" message for dashboard widgets -- before
 * this, some widgets (Source-wise split) had their own inline empty-state
 * text while others (Category-wise split, Rejected-vs-withdrawn) had none at
 * all and instead rendered a chart with real axes/gridlines around all-zero
 * bars, which reads as "broken chart", not "no data" (CLAUDE.md B5).
 */
export function EmptyState({ message, className }: EmptyStateProps) {
  return <p className={cn("text-xs text-muted-foreground", className)}>{message}</p>;
}
