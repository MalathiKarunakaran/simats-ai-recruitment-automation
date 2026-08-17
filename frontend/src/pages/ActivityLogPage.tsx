import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { listAuditLogs } from "@/api/auditLogs";
import { listCampuses } from "@/api/campuses";
import { GLOBAL_SCOPE_ROLES } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { DateRangeControl, type DateRangeValue } from "@/components/dashboard/DateRangeControl";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Mirrors the backend's own read-role gate exactly
// (app/api/v1/routers/audit_logs.py::_READ_ROLES).
const CAN_VIEW_ROLES = ["SUPER_ADMIN", "HR_ADMIN", "ASSOCIATE_DEAN_RECRUITMENT", "CAMPUS_HOD"];

const ENTITY_TYPES = [
  "VacancyRequest",
  "Application",
  "Offer",
  "InterviewSchedule",
  "JoiningRecord",
  "User",
  "Employee",
];

export function ActivityLogPage() {
  const { user } = useAuth();
  const [entityType, setEntityType] = useState<string>("ALL");
  const [campusId, setCampusId] = useState<string>("ALL");
  const [dateRange, setDateRange] = useState<DateRangeValue>({ startDate: null, endDate: null });

  const canView = Boolean(user && CAN_VIEW_ROLES.includes(user.role));
  // CAMPUS_HOD is hard-pinned to their own campus server-side regardless of
  // any campus_id passed, so the filter only means anything for the 3
  // global-scope roles among the readers.
  const canFilterByCampus = Boolean(user && GLOBAL_SCOPE_ROLES.includes(user.role));

  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses, enabled: canFilterByCampus });

  const { data: entries, isLoading } = useQuery({
    queryKey: ["audit-logs", entityType, campusId, dateRange.startDate, dateRange.endDate],
    queryFn: () =>
      listAuditLogs({
        entityType: entityType === "ALL" ? null : entityType,
        campusId: campusId === "ALL" ? null : campusId,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
      }),
    enabled: canView,
  });

  if (!canView) {
    return (
      <p className="text-sm text-muted-foreground">
        Only Super Admin, HR Admin, Associate Dean (Recruitment), or a Campus HOD can view the activity log.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Activity Log</h1>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-56">
          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger aria-label="Entity type filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All entity types</SelectItem>
              {ENTITY_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canFilterByCampus ? (
          <div className="w-56">
            <Select value={campusId} onValueChange={setCampusId}>
              <SelectTrigger aria-label="Campus filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All campuses</SelectItem>
                {campuses?.map((campus) => (
                  <SelectItem key={campus.id} value={campus.id}>
                    {campus.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <DateRangeControl value={dateRange} onChange={setDateRange} ariaLabel="Date range" />
      </div>

      {/* UI redesign Phase 3 -- the loading/empty/table states share one
          Card boundary regardless of which is currently rendered, rather
          than only wrapping the table once data loads. */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : !entries || entries.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No activity recorded in this scope yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 font-medium">When</th>
                    <th className="py-2 font-medium">Actor</th>
                    <th className="py-2 font-medium">Action</th>
                    <th className="py-2 font-medium">Entity</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-border last:border-0">
                      <td className="py-2 whitespace-nowrap">{new Date(entry.created_at).toLocaleString()}</td>
                      <td className="py-2">{entry.actor_role_snapshot?.replace(/_/g, " ") ?? "System"}</td>
                      <td className="py-2 font-mono text-xs">{entry.action}</td>
                      <td className="py-2 text-muted-foreground">
                        {entry.entity_type ?? "—"}
                        {entry.entity_id ? ` · ${entry.entity_id.slice(0, 8)}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
