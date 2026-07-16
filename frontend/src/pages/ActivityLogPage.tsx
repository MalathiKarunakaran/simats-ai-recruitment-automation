import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { listAuditLogs } from "@/api/auditLogs";
import { useAuth } from "@/auth/AuthContext";
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

  const canView = Boolean(user && CAN_VIEW_ROLES.includes(user.role));

  const { data: entries, isLoading } = useQuery({
    queryKey: ["audit-logs", entityType],
    queryFn: () => listAuditLogs({ entityType: entityType === "ALL" ? null : entityType }),
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

      <div className="w-56">
        <Select value={entityType} onValueChange={setEntityType}>
          <SelectTrigger>
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

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !entries || entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity recorded in this scope yet.</p>
      ) : (
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
      )}
    </div>
  );
}
