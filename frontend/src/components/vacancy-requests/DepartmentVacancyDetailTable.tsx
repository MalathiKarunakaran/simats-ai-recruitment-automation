import { Link } from "react-router-dom";

import type { CampusRead, VacancyRequestRead } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted">
                          <tr className="text-left text-muted-foreground">
                            <th className="px-3 py-2 text-table-header font-medium">Required</th>
                            <th className="px-3 py-2 text-table-header font-medium">Filled</th>
                            <th className="px-3 py-2 text-table-header font-medium">Remaining</th>
                            <th className="px-3 py-2 text-table-header font-medium">Employment</th>
                            <th className="px-3 py-2 text-table-header font-medium">Priority</th>
                            <th className="px-3 py-2 text-table-header font-medium">Status</th>
                            {canResolveRequesterNames ? (
                              <th className="px-3 py-2 text-table-header font-medium">Requested by</th>
                            ) : null}
                            <th className="px-3 py-2 text-table-header font-medium">Requested</th>
                            <th className="px-3 py-2 text-table-header font-medium">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {rows.map((vr) => {
                            const stats = fillStatsByRequestId.get(vr.id) ?? { filled: 0, remaining: vr.requested_count };
                            return (
                              <tr key={vr.id} className="transition-colors hover:bg-accent/50">
                                <td className="px-3 py-2 tabular-nums">{vr.requested_count}</td>
                                <td className="px-3 py-2 tabular-nums">{stats.filled}</td>
                                <td className="px-3 py-2 tabular-nums">{stats.remaining}</td>
                                <td className="px-3 py-2">{vr.employment_type.replace(/_/g, " ")}</td>
                                <td className="px-3 py-2">
                                  {vr.priority === "URGENT" ? (
                                    <Badge variant="destructive">{vr.priority}</Badge>
                                  ) : (
                                    vr.priority
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  <StatusBadge status={vr.status} />
                                </td>
                                {canResolveRequesterNames ? (
                                  <td className="px-3 py-2">{requesterNameById.get(vr.requested_by_id) ?? "—"}</td>
                                ) : null}
                                <td className="px-3 py-2">{new Date(vr.created_at).toLocaleDateString()}</td>
                                <td className="px-3 py-2">
                                  <Button variant="outline" size="sm" asChild>
                                    <Link to={`/vacancy-requests/${vr.id}`}>View</Link>
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
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
