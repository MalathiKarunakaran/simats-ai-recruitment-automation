import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function formatHeader(key: string): string {
  const words = key.replace(/_/g, " ").split(" ");
  return words.map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(" ");
}

/** Renders any of the backend's 7 generic report row shapes -- columns are
 * derived from the first row's keys rather than hardcoded per report type,
 * mirroring the backend's own "one generic shape for all reports" design
 * (see app/schemas/reporting.py::ReportResponse).
 *
 * Step 8 sweep -- the non-empty render path migrated onto the shared Table
 * primitive (same swap every page-level table in this epic used); this is
 * the one report-rendering component that wasn't a page itself but backs
 * most of ReportsPage's own report types, so completing the sweep here too
 * keeps it visually consistent with everything else, not just page-level
 * tables. The empty case still returns a bare `<p>`, unlike page-level
 * tables' TableEmpty-inside-a-persistent-shell pattern -- this component
 * doesn't know its columns until it has at least one row (they're derived
 * from `rows[0]`'s keys), so there's no fixed header to keep showing while
 * swapping only the body, the way every other migrated table can. */
export function GenericReportTable({ rows }: { rows: Record<string, string | number>[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No data in this scope yet.</p>;
  }

  const columns = Object.keys(rows[0]);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column} className="px-0 py-1.5 pr-4">
              {formatHeader(column)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={index}>
            {columns.map((column) => (
              <TableCell key={column} className="px-0 py-1.5 pr-4">
                {row[column]}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
