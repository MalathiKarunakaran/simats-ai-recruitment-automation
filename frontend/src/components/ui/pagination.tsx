import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Design-system-foundation step 2 -- replaces the "Showing X-Y of Z" +
// Previous/Next Button block copy-pasted verbatim across SanctionedStrengthPage,
// TeachingStrengthTable, NonTeachingStrengthTable, HousekeepingStrengthTable
// (each computes total/offset/limit from a server-paginated response and
// drives a local `page` state var). This component only owns the display +
// button-disabled logic; it stays offset-based (not page-number-based) since
// that's what every existing call site's query response already carries
// (`data?.total`/`data?.offset`/`data?.limit`) -- a caller using local `page`
// state can adapt with `onOffsetChange={(next) => setPage(next / limit)}`.
// This step only builds the primitive -- none of the four pages above are
// migrated to it yet (see the calling task's explicit scope).

export interface PaginationProps {
  /** Total number of matching records across all pages (server-reported). */
  total: number;
  /** Page size -- how many records `offset` moves by per Previous/Next click. */
  limit: number;
  /** Zero-based index of the first record on the current page. */
  offset: number;
  onOffsetChange: (offset: number) => void;
  /** Plural noun for the "Showing X-Y of Z ___" caption, e.g. "designations". */
  itemLabel?: string;
  className?: string;
}

export function Pagination({
  total,
  limit,
  offset,
  onOffsetChange,
  itemLabel = "results",
  className,
}: PaginationProps) {
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + limit, total);
  const canGoPrevious = offset > 0;
  const canGoNext = offset + limit < total;

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2", className)}>
      <p className="text-xs text-muted-foreground">
        Showing {showingFrom}–{showingTo} of {total} {itemLabel}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canGoPrevious}
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canGoNext}
          onClick={() => onOffsetChange(offset + limit)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
