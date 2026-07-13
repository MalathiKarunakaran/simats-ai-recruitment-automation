import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listCampuses } from "@/api/campuses";
import type { VacancyRequestStatus } from "@/api/types";
import { listVacancyRequests } from "@/api/vacancyRequests";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/vacancy-requests/StatusBadge";

const STATUSES: VacancyRequestStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "DEAN_APPROVED",
  "APPROVED",
  "PUBLISHED",
  "CLOSED",
  "REJECTED",
];

const CAN_CREATE_ROLES = ["CAMPUS_HOD", "SUPER_ADMIN"];

export function VacancyRequestsListPage() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<VacancyRequestStatus | "ALL">("ALL");

  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });
  const { data: vacancyRequests, isLoading } = useQuery({
    queryKey: ["vacancy-requests", statusFilter],
    queryFn: () => listVacancyRequests(statusFilter === "ALL" ? null : statusFilter),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Vacancy Requests</h1>
        {user && CAN_CREATE_ROLES.includes(user.role) ? (
          <Button asChild>
            <Link to="/vacancy-requests/new">New vacancy request</Link>
          </Button>
        ) : null}
      </div>

      <div className="w-56">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as VacancyRequestStatus | "ALL")}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {status.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !vacancyRequests || vacancyRequests.length === 0 ? (
        <p className="text-sm text-muted-foreground">No vacancy requests in this scope yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 font-medium">Position</th>
              <th className="py-2 font-medium">Campus</th>
              <th className="py-2 font-medium">Role category</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Priority</th>
              <th className="py-2 font-medium">Count</th>
              <th className="py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {vacancyRequests.map((vr) => {
              const campus = campuses?.find((c) => c.id === vr.campus_id);
              return (
                <tr key={vr.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="py-2">
                    <Link to={`/vacancy-requests/${vr.id}`} className="font-medium hover:underline">
                      {vr.position_title}
                    </Link>
                  </td>
                  <td className="py-2">{campus?.code ?? "—"}</td>
                  <td className="py-2">{vr.role_category.replace(/_/g, " ")}</td>
                  <td className="py-2">
                    <StatusBadge status={vr.status} />
                  </td>
                  <td className="py-2">{vr.priority}</td>
                  <td className="py-2">{vr.requested_count}</td>
                  <td className="py-2">{new Date(vr.created_at).toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
