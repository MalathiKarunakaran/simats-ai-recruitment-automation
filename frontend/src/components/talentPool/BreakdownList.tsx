import type { TalentPoolBreakdownItem } from "@/api/types";
import { EmptyState } from "@/components/dashboard/EmptyState";

/**
 * One breakdown panel (spec 1.5): a ranked list of label, count and a thin
 * bar. The API has already taken the top 8 and folded the rest into
 * "Others", and already decided the order -- ranked for most panels, and a
 * fixed order for the eligibility and call-outcome panels, where the
 * sequence carries meaning that sorting by size would destroy. This
 * component therefore renders the list as given and does not re-sort it.
 */

interface BreakdownListProps {
  title: string;
  items: TalentPoolBreakdownItem[];
  subLine?: string;
  emptyMessage?: string;
}

export function BreakdownList({ title, items, subLine, emptyMessage }: BreakdownListProps) {
  // Relative to the largest entry present, so a panel whose values are all
  // small still shows usable bars.
  const largest = items.reduce((max, item) => Math.max(max, item.count), 0);
  const hasAny = items.some((item) => item.count > 0);

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-xs font-semibold">{title}</h3>
        {subLine ? <p className="text-[11px] text-muted-foreground">{subLine}</p> : null}
      </div>

      {!hasAny ? (
        <EmptyState message={emptyMessage ?? "Nothing recorded for this sheet yet."} />
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.label} className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="truncate" title={item.label}>{item.label}</span>
                <span className="shrink-0 font-medium tabular-nums">{item.count}</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  aria-hidden="true"
                  className="h-full rounded-full bg-brand-primary/60"
                  style={{ width: largest > 0 ? `${(item.count / largest) * 100}%` : "0%" }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
