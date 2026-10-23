import type { TalentPoolDepartmentRow, TalentPoolSourceTab } from "@/api/types";
import { cn } from "@/lib/utils";

/**
 * The by-department table (spec 1.4).
 *
 * Teaching gets a Grouped / As-in-sheet toggle; NTS does not, because its
 * `dept_group` is just the trimmed name and the two views would be the same
 * table. The toggle is the whole reason the backend keeps both columns: a
 * grouping is our interpretation of about 260 hand-typed spellings, and
 * "As in sheet" is what makes a wrong grouping traceable to what was typed.
 *
 * Rows are interactive `<tr>`s with onClick + Enter rather than links. The
 * tiles use anchors deliberately (see TalentPoolTiles), but an anchor cannot
 * wrap a table row without breaking the table's structure, so this is the
 * one place a keyboard handler is the honest implementation rather than a
 * shortcut -- hence the explicit tabIndex and Enter/Space handling.
 */

interface DepartmentTableProps {
  rows: TalentPoolDepartmentRow[];
  tab: TalentPoolSourceTab;
  deptMode: "group" | "raw";
  departmentCount: number;
  onDeptModeChange: (mode: "group" | "raw") => void;
  onSelectDepartment: (department: string) => void;
}

export function DepartmentTable({
  rows,
  tab,
  deptMode,
  departmentCount,
  onDeptModeChange,
  onSelectDepartment,
}: DepartmentTableProps) {
  const teaching = tab === "TEACHING_FINAL";
  // The inline bar is relative to the biggest row, not to the total -- the
  // question it answers is "how does this department compare with the
  // largest", which a share-of-total bar would make unreadable for a long
  // tail of small departments.
  const largest = rows.reduce((max, row) => Math.max(max, row.total), 0);

  const openLabel = teaching ? "Pending" : "Open";

  const subLine = teaching
    ? deptMode === "group"
      ? `${departmentCount} groups made from Actual Dept for counting (CSE includes IT, MCA, BCA, CS). Your sheet is unchanged.`
      : `${departmentCount} departments exactly as typed in Actual Dept.`
    : `${departmentCount} ${departmentCount === 1 ? "department" : "departments"}.`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">By department</h2>
        {teaching ? (
          <div role="group" aria-label="Department grouping" className="flex rounded-md border border-border p-0.5">
            {([
              { mode: "group" as const, label: "Grouped" },
              { mode: "raw" as const, label: "As in sheet" },
            ]).map((option) => (
              <button
                key={option.mode}
                type="button"
                aria-pressed={deptMode === option.mode}
                onClick={() => onDeptModeChange(option.mode)}
                className={cn(
                  "rounded px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  deptMode === option.mode
                    ? "bg-brand-primary text-white"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <p className="text-[11px] text-muted-foreground">{subLine}</p>

      {/* Scrolls inside its own container, so a wide table never makes the
          page itself scroll sideways (spec 1.4 and 1.7). */}
      <div className="max-h-80 overflow-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border text-left">
              <th scope="col" className="px-2 py-1.5 font-medium">Department</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Total</th>
              {teaching ? (
                <th scope="col" className="px-2 py-1.5 text-right font-medium">Eligible</th>
              ) : null}
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Selected</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Waiting</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Rejected</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">{openLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.department}
                tabIndex={0}
                onClick={() => onSelectDepartment(row.department)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectDepartment(row.department);
                  }
                }}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <td className="px-2 py-1.5">
                  <span className="flex items-center gap-2">
                    <span className="truncate">{row.department}</span>
                    <span
                      aria-hidden="true"
                      className="h-1 shrink-0 rounded-full bg-brand-primary/50"
                      style={{ width: largest > 0 ? `${Math.max(2, (row.total / largest) * 40)}px` : 0 }}
                    />
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right font-medium tabular-nums">{row.total}</td>
                {teaching ? (
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.eligible}</td>
                ) : null}
                <td className="px-2 py-1.5 text-right tabular-nums">{row.selected}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{row.waiting}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{row.rejected}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{row.open}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
