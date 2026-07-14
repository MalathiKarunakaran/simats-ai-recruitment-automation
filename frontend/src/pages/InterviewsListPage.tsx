import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listApplications } from "@/api/applications";
import { listCandidates } from "@/api/candidates";
import { listInterviews } from "@/api/interviews";
import type { InterviewScheduleStatus } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge } from "@/components/interviews/StatusBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

const STATUSES: InterviewScheduleStatus[] = ["SCHEDULED", "COMPLETED", "CANCELLED", "RESCHEDULED"];
const CAN_CREATE_ROLES = ["RECRUITMENT_OFFICER", "HR_ADMIN", "SUPER_ADMIN"];

export function InterviewsListPage() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<InterviewScheduleStatus | "ALL">("ALL");

  const { data: interviews, isLoading } = useQuery({
    queryKey: ["interviews", { status: statusFilter }],
    queryFn: () => listInterviews({ status: statusFilter === "ALL" ? null : statusFilter }),
  });
  const { data: applications } = useQuery({ queryKey: ["applications", {}], queryFn: () => listApplications() });
  const { data: candidates } = useQuery({ queryKey: ["candidates", ""], queryFn: () => listCandidates() });
  const { getLabel } = useJobPostingLookup();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Interviews</h1>
        {user && CAN_CREATE_ROLES.includes(user.role) ? (
          <Button asChild>
            <Link to="/interviews/new">Schedule interview</Link>
          </Button>
        ) : null}
      </div>

      <div className="w-64">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as InterviewScheduleStatus | "ALL")}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !interviews || interviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">No interviews in this scope yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 font-medium">Candidate</th>
              <th className="py-2 font-medium">Position</th>
              <th className="py-2 font-medium">Type</th>
              <th className="py-2 font-medium">Scheduled</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {interviews.map((interview) => {
              const application = applications?.find((a) => a.id === interview.application_id);
              const candidate = application ? candidates?.find((c) => c.id === application.candidate_id) : undefined;
              const label = application ? getLabel(application.job_posting_id) : undefined;
              return (
                <tr key={interview.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="py-2">
                    <Link to={`/interviews/${interview.id}`} className="font-medium hover:underline">
                      {candidate?.full_name ?? "Unknown candidate"}
                    </Link>
                    <div className="text-xs text-muted-foreground">{candidate?.email}</div>
                  </td>
                  <td className="py-2">{label?.positionTitle ?? "—"}</td>
                  <td className="py-2">{interview.interview_type.replace(/_/g, " ")}</td>
                  <td className="py-2">{new Date(interview.scheduled_at).toLocaleString()}</td>
                  <td className="py-2">
                    <StatusBadge status={interview.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
