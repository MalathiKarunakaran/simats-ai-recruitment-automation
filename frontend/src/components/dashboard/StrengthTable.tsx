import { useNavigate } from "react-router-dom";

import type { DashboardStrengthTableRow } from "@/api/types";
import { CategoryBadge } from "@/components/domain/CategoryBadge";
import { STATUS_DISPLAY } from "@/components/sanctionedStrength/TeachingStrengthTable";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// The dashboard's main table (2026-08-30). Deliberately thin: every number
// arrives already computed by GET /dashboard/strength-table, which reuses the
// three Sanctioned Strength view services, so this component does NOT
// recompute vacancy or filled % client-side. Two surfaces deriving the same
// figure independently is exactly how they drift apart.
//
// Status badges reuse TeachingStrengthTable's exported STATUS_DISPLAY rather
// than growing a second status vocabulary for the same five states.

interface StrengthTableProps {
  rows: DashboardStrengthTableRow[];
  isLoading: boolean;
}

/** Rendered instead of a bare "-" so an empty cell reads as "nothing here"
 * rather than as a failed lookup. */
const EMPTY_CELL = "—";

export function StrengthTable({ rows, isLoading }: StrengthTableProps) {
  const navigate = useNavigate();

  if (isLoading) {
    return <div role="status" aria-label="Loading strength table" className="h-48 animate-pulse rounded bg-muted" />;
  }

  // The brief is explicit that an empty scope shows 0, not a large empty card.
  if (rows.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-2xl font-bold tabular-nums text-foreground">0</p>
        <p className="mt-1 text-xs text-muted-foreground">No sanctioned positions match these filters.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Campus</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Designation</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Location</TableHead>
            <TableHead className="text-right">Sanctioned</TableHead>
            <TableHead className="text-right">Working</TableHead>
            <TableHead className="text-right">Vacancy</TableHead>
            <TableHead className="text-right">Filled %</TableHead>
            <TableHead>Recruitment Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const display = STATUS_DISPLAY[row.status];
            // Housekeeping rows are Location-grained and aggregate several
            // sanctioned records, so there is no single record to open. They
            // stay non-interactive rather than linking somewhere misleading.
            const isDrillable = row.sanctioned_strength_id !== null;
            const open = () => {
              if (!isDrillable) return;
              navigate(`/sanctioned-strength?highlight=${row.sanctioned_strength_id}`);
            };
            return (
              <TableRow
                // sanctioned_strength_id is null for every Housekeeping row,
                // so it cannot be the key on its own.
                key={row.sanctioned_strength_id ?? `hk-${row.location_id ?? index}`}
                data-testid="strength-table-row"
                className={isDrillable ? "cursor-pointer" : undefined}
                onClick={open}
                // Keyboard parity for the row click -- a pointer-only
                // drill-down would be unreachable without a mouse.
                tabIndex={isDrillable ? 0 : undefined}
                role={isDrillable ? "button" : undefined}
                onKeyDown={
                  isDrillable
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          open();
                        }
                      }
                    : undefined
                }
              >
                <TableCell>{row.campus_code ?? EMPTY_CELL}</TableCell>
                <TableCell className="font-medium text-foreground">{row.department_name}</TableCell>
                <TableCell>{row.designation_name}</TableCell>
                <TableCell>
                  <CategoryBadge category={row.category} />
                </TableCell>
                <TableCell>{row.location_name ?? EMPTY_CELL}</TableCell>
                <TableCell className="text-right tabular-nums">{row.approved}</TableCell>
                <TableCell className="text-right tabular-nums">{row.working}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{row.vacancy}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.filled_pct === null ? EMPTY_CELL : `${row.filled_pct}%`}
                </TableCell>
                <TableCell>
                  <Badge variant={display.variant}>{display.label}</Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
