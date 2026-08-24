import { Link } from "react-router-dom";

import type { CampusRead, VacancyRequestRead } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/vacancy-requests/StatusBadge";

export interface FillStats {
  filled: number;
  remaining: number;
}

// Groups this department's (already page-filtered) requests into
// Teaching/Non-Teaching/Housekeeping -> Designation (position_title) ->
// Campus, per the requested information architecture. Plain nested Maps,
// not further collapsible levels -- four levels of literal nested
// accordions would fight the "generous whitespace, reduce clutter" brief
// more than it would help.
function groupByRoleThenDesignationThenCampus(requests: VacancyRequestRead[]) {
  const byRole = new Map<string, Map<string, Map<string, VacancyRequestRead[]>>>();
  for (const req of requests) {
    if (!byRole.has(req.role_category)) byRole.set(req.role_category, new Map());
    const byDesignation = byRole.get(req.role_category)!;
    if (!byDesignation.has(req.position_title)) byDesignation.set(req.position_title, new Map());
    const byCampus = byDesignation.get(req.position_title)!;
    if (!byCampus.has(req.campus_id)) byCampus.set(req.campus_id, []);
    byCampus.get(req.campus_id)!.push(req);
  }
  return byRole;
}

interface DepartmentVacancyDetailTableProps {
  requests: VacancyRequestRead[];
  campusById: Map<string, CampusRead>;
  fillStatsByRequestId: Map<string, FillStats>;
  requesterNameById: Map<string, string>;
  canResolveRequesterNames: boolean;
}

// The detailed, drill-down vacancy table for a single department -- role
// category -> designation -> campus -> rows. Originally the body of an
// accordion keyed off the department's own header (see git history); now a
// standalone component shown when a DepartmentCard in the Vacancy Requests
// grid is clicked, so it no longer owns its own department-name header or
// open/close chrome -- the caller decides how/where to render it.
//
// Design-system-foundation step 5: migrated its hand-rolled <table> onto the
// shared Table primitive (components/ui/table.tsx), same swap
// SanctionedStrengthPage's own nested breakdown table already made in step
// 4. The outer `rounded-lg border border-border` box is kept as this
// component's own wrapper (Table itself only owns the inner
// `overflow-x-auto`, not a border/radius -- see that primitive's docstring)
// so the per-campus mini-table still reads as its own bounded card, same as
// before.
export function DepartmentVacancyDetailTable({
  requests,
  campusById,
  fillStatsByRequestId,
  requesterNameById,
  canResolveRequesterNames,
}: DepartmentVacancyDetailTableProps) {
  const grouped = groupByRoleThenDesignationThenCampus(requests);

  return (
    <div className="flex flex-col gap-5">
      {Array.from(grouped.entries()).map(([roleCategory, byDesignation]) => (
        <div key={roleCategory} className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {roleCategory.replace(/_/g, " ")}
          </h3>
          {Array.from(byDesignation.entries()).map(([designation, byCampus]) => (
            <div key={designation} className="flex flex-col gap-2 pl-3">
              <h4 className="text-sm font-medium text-foreground">{designation}</h4>
              {Array.from(byCampus.entries()).map(([campusId, rows]) => {
                const campus = campusById.get(campusId);
                return (
                  <div key={campusId} className="flex flex-col gap-1.5 pl-3">
                    <span className="font-mono text-[11px] text-muted-foreground">{campus?.code ?? "—"}</span>
                    <div className="rounded-lg border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Required</TableHead>
                            <TableHead>Filled</TableHead>
                            <TableHead>Remaining</TableHead>
                            <TableHead>Employment</TableHead>
                            <TableHead>Priority</TableHead>
                            <TableHead>Status</TableHead>
                            {canResolveRequesterNames ? <TableHead>Requested by</TableHead> : null}
                            <TableHead>Requested</TableHead>
                            <TableHead>Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((vr) => {
                            const stats = fillStatsByRequestId.get(vr.id) ?? { filled: 0, remaining: vr.requested_count };
                            return (
                              <TableRow key={vr.id}>
                                <TableCell className="tabular-nums">{vr.requested_count}</TableCell>
                                <TableCell className="tabular-nums">{stats.filled}</TableCell>
                                <TableCell className="tabular-nums">{stats.remaining}</TableCell>
                                <TableCell>{vr.employment_type.replace(/_/g, " ")}</TableCell>
                                <TableCell>
                                  {vr.priority === "URGENT" ? (
                                    <Badge variant="destructive">{vr.priority}</Badge>
                                  ) : (
                                    vr.priority
                                  )}
                                </TableCell>
                                <TableCell>
                                  <StatusBadge status={vr.status} />
                                </TableCell>
                                {canResolveRequesterNames ? (
                                  <TableCell>{requesterNameById.get(vr.requested_by_id) ?? "—"}</TableCell>
                                ) : null}
                                <TableCell>{new Date(vr.created_at).toLocaleDateString()}</TableCell>
                                <TableCell>
                                  <Button variant="outline" size="sm" asChild>
                                    <Link to={`/vacancy-requests/${vr.id}`}>View</Link>
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
