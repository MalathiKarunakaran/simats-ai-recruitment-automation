import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listApplications } from "@/api/applications";
import { listCandidates } from "@/api/candidates";
import { APPLICATION_STATUS_ORDER } from "@/api/types";
import type { ApplicationStatus } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge } from "@/components/applications/StatusBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

const CAN_CREATE_ROLES = ["RECRUITMENT_OFFICER", "HR_ADMIN", "SUPER_ADMIN"];

export function ApplicationsListPage() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "ALL">("ALL");

  const { data: applications, isLoading } = useQuery({
    queryKey: ["applications", { status: statusFilter }],
    queryFn: () => listApplications({ status: statusFilter === "ALL" ? null : statusFilter }),
  });
  const { data: candidates } = useQuery({ queryKey: ["candidates", ""], queryFn: () => listCandidates() });
  const { getLabel } = useJobPostingLookup();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Applications</h1>
        {user && CAN_CREATE_ROLES.includes(user.role) ? (
          <Button asChild>
            <Link to="/applications/new">New application</Link>
          </Button>
        ) : null}
      </div>

      <div className="w-64">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ApplicationStatus | "ALL")}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {APPLICATION_STATUS_ORDER.concat("REJECTED", "WITHDRAWN").map((status) => (
              <SelectItem key={status} value={status}>
                {status.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !applications || applications.length === 0 ? (
        <p className="text-sm text-muted-foreground">No applications in this scope yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 font-medium">Candidate</th>
              <th className="py-2 font-medium">Position</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Applied</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((application) => {
              const candidate = candidates?.find((c) => c.id === application.candidate_id);
              const label = getLabel(application.job_posting_id);
              return (
                <tr key={application.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="py-2">
                    <Link to={`/applications/${application.id}`} className="font-medium hover:underline">
                      {candidate?.full_name ?? "Unknown candidate"}
                    </Link>
                    <div className="text-xs text-muted-foreground">{candidate?.email}</div>
                  </td>
                  <td className="py-2">{label?.positionTitle ?? "—"}</td>
                  <td className="py-2">
                    <StatusBadge status={application.status} />
                  </td>
                  <td className="py-2">{new Date(application.applied_at).toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
