import { Button } from "@/components/ui/button";

/**
 * "Showing: … · Clear filters" -- the Talent Pool register's line, shared by
 * the Joining pages. A list reached by clicking a count always says which
 * count it is, and how many rows that filter found.
 */
interface ActiveFiltersLineProps {
  parts: string[];
  total?: number;
  noun: [singular: string, plural: string];
  onClear: () => void;
}

export function ActiveFiltersLine({ parts, total, noun, onClear }: ActiveFiltersLineProps) {
  if (parts.length === 0) return null;
  return (
    <div
      data-testid="joining-active-filters"
      aria-live="polite"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"
    >
      <p>
        <span className="font-semibold">Showing:</span> {parts.join(" · ")}
        {total !== undefined ? (
          <span className="font-semibold">
            {` — ${total.toLocaleString("en-IN")} ${total === 1 ? noun[0] : noun[1]}`}
          </span>
        ) : null}
      </p>
      <Button variant="outline" size="sm" className="h-7" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  );
}
