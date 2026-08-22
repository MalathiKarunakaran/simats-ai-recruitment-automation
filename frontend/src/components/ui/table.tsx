import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

// Design-system-foundation step 2 -- a shared table primitive informed by
// the hand-rolled markup already duplicated across ApplicationsListPage,
// InterviewsListPage, SanctionedStrengthPage, TeachingStrengthTable,
// NonTeachingStrengthTable, HousekeepingStrengthTable, VacancyRequestsListPage,
// VacancyApprovalsPage (all: a Card/CardContent p-0 wrapper around the table,
// divide-y divide-border row separators or a per-row border-b, hover:bg-accent/50,
// text-table-header on header cells, sortable columns via a chevron-icon
// button in the <th>). Deliberately exported as composable pieces (not one
// monolithic <Table rows={...} columns={...} /> component) so each of those
// pages can adopt this incrementally later without first being forced into
// one exact column/row shape -- this step only builds and unit-verifies the
// primitive, it does NOT migrate any page (see the calling task's explicit
// scope).
//
// `Table` itself owns the `overflow-x-auto` wrapper so callers don't have to
// think about horizontal scroll on narrow viewports; nesting it inside a
// `CardContent className="p-0"` (this codebase's established wrapper, see
// card.tsx) is harmless even where CardContent also sets `overflow-x-auto`
// itself, which is why that's left as the caller's choice rather than baked
// in here -- keeping `Table` about the `<table>` alone, not about deciding
// its outer chrome.

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-sm", className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      className={cn("border-b border-border bg-muted/50 text-left text-muted-foreground", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-border", className)} {...props} />;
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("transition-colors hover:bg-accent/50", className)} {...props} />;
}

export type TableSortDirection = "asc" | "desc";

interface TableHeadProps extends React.ComponentProps<"th"> {
  /** Current sort direction for THIS column, or `false`/`undefined` when it isn't the active sort column. */
  sorted?: TableSortDirection | false;
  /** Presence of this prop is what turns the header into a sort-toggle button -- omit for a plain (non-sortable) column. */
  onSort?: () => void;
}

function TableHead({ className, sorted = false, onSort, children, ...props }: TableHeadProps) {
  const ariaSort: React.AriaAttributes["aria-sort"] = onSort
    ? sorted === "asc"
      ? "ascending"
      : sorted === "desc"
        ? "descending"
        : "none"
    : undefined;

  return (
    <th
      className={cn("px-3 py-2 text-table-header font-medium", className)}
      aria-sort={ariaSort}
      {...props}
    >
      {onSort ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            "flex items-center gap-1 transition-colors hover:text-foreground",
            sorted && "text-foreground",
          )}
        >
          {children}
          {sorted === "asc" ? (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          ) : sorted === "desc" ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" aria-hidden="true" />
          )}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-2", className)} {...props} />;
}

interface TableEmptyProps extends Omit<React.ComponentProps<"td">, "colSpan"> {
  /** Must match the number of `TableHead`s so the message spans the full table width. */
  colSpan: number;
  /** Swaps the default empty-state copy for "Loading…" -- the same row shape covers both states, matching every existing page's markup (only the text/color differs). */
  loading?: boolean;
}

function TableEmpty({ colSpan, loading = false, className, children, ...props }: TableEmptyProps) {
  return (
    <tr>
      <td colSpan={colSpan} className={cn("px-3 py-4 text-sm text-muted-foreground", className)} {...props}>
        {children ?? (loading ? "Loading…" : "No results found.")}
      </td>
    </tr>
  );
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty };
