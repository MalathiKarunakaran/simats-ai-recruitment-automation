import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { listAuditLogs } from "@/api/auditLogs";
import { listCampuses } from "@/api/campuses";
import { GLOBAL_SCOPE_ROLES } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { DateRangeControl, type DateRangeValue } from "@/components/dashboard/DateRangeControl";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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

const TOTAL_COLUMN_COUNT = 4;

export function ActivityLogPage() {
  const { user, hasPermission } = useAuth();
  const [entityType, setEntityType] = useState<string>("ALL");
  const [campusId, setCampusId] = useState<string>("ALL");
  const [dateRange, setDateRange] = useState<DateRangeValue>({ startDate: null, endDate: null });

  // Bug fix: OR'd with hasPermission("ACTIVITY_LOG") -- both audit_logs.py
  // endpoints are gated by require_permission(ACTIVITY_LOG), not a role
  // list, so someone individually granted the permission (but outside
  // CAN_VIEW_ROLES) must still be able to view this page, same pattern as
  // UsersListPage's canManage.
  const canView = Boolean(user && (CAN_VIEW_ROLES.includes(user.role) || hasPermission?.("ACTIVITY_LOG")));
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableEmpty colSpan={TOTAL_COLUMN_COUNT} loading />
              ) : !entries || entries.length === 0 ? (
                <TableEmpty colSpan={TOTAL_COLUMN_COUNT}>No activity recorded in this scope yet.</TableEmpty>
              ) : (
                entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">{new Date(entry.created_at).toLocaleString()}</TableCell>
                    <TableCell>{entry.actor_role_snapshot?.replace(/_/g, " ") ?? "System"}</TableCell>
                    <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry.entity_type ?? "—"}
                      {entry.entity_id ? ` · ${entry.entity_id.slice(0, 8)}` : ""}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
