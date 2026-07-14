function formatHeader(key: string): string {
  const words = key.replace(/_/g, " ").split(" ");
  return words.map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(" ");
}

/** Renders any of the backend's 7 generic report row shapes -- columns are
 * derived from the first row's keys rather than hardcoded per report type,
 * mirroring the backend's own "one generic shape for all reports" design
 * (see app/schemas/reporting.py::ReportResponse). */
export function GenericReportTable({ rows }: { rows: Record<string, string | number>[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No data in this scope yet.</p>;
  }

  const columns = Object.keys(rows[0]);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          {columns.map((column) => (
            <th key={column} className="py-1.5 pr-4 font-medium">
              {formatHeader(column)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index} className="border-b border-border last:border-0">
            {columns.map((column) => (
              <td key={column} className="py-1.5 pr-4">
                {row[column]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
