import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Page-size selector (Departments production-hardening epic, frontend Phase
// 2) -- no page in this codebase had one before; DepartmentsPage is the
// first caller to opt in via the new optional `onLimitChange` prop below.
// Deliberately extending this one shared primitive rather than a new
// component: every existing caller that omits `onLimitChange` renders
// exactly as before (no selector shown), so this is purely additive.
const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

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
  /** Presence of this prop is what turns on the page-size `Select` -- omit it
   * (as every pre-existing caller does) to render exactly as before. When
   * the page size changes, the caller is responsible for also resetting
   * `offset` back to 0 (same as any other filter change) -- this component
   * only reports the new limit, it doesn't recompute offset itself since it
   * has no opinion on whether the caller tracks a raw offset or a page index. */
  onLimitChange?: (limit: number) => void;
  /** Options for the page-size `Select` -- defaults to 10/25/50/100. Only
   * consulted when `onLimitChange` is provided. */
  limitOptions?: number[];
}

export function Pagination({
  total,
  limit,
  offset,
  onOffsetChange,
  itemLabel = "results",
  className,
  onLimitChange,
  limitOptions = DEFAULT_PAGE_SIZE_OPTIONS,
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
        {onLimitChange ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Rows per page</span>
            <Select value={String(limit)} onValueChange={(v) => onLimitChange(Number(v))}>
              <SelectTrigger aria-label="Rows per page" className="h-8 w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* Always include the current limit as an option, even if it
                    isn't one of `limitOptions` -- otherwise a caller-supplied
                    initial limit that doesn't match any option would render
                    an empty trigger. */}
                {(limitOptions.includes(limit) ? limitOptions : [...limitOptions, limit].sort((a, b) => a - b)).map(
                  (option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
        ) : null}
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
