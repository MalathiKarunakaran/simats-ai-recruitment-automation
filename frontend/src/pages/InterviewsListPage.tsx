import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listApplications } from "@/api/applications";
import { listCampuses } from "@/api/campuses";
import { listCandidates } from "@/api/candidates";
import { listInterviews } from "@/api/interviews";
import type { InterviewScheduleStatus } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge } from "@/components/interviews/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

const STATUSES: InterviewScheduleStatus[] = ["SCHEDULED", "COMPLETED", "CANCELLED", "RESCHEDULED"];
const CAN_CREATE_ROLES = ["RECRUITMENT_OFFICER", "HR_ADMIN", "SUPER_ADMIN"];

export function InterviewsListPage() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<InterviewScheduleStatus | "ALL">("ALL");
  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [myInterviewsOnly, setMyInterviewsOnly] = useState(false);

  const { data: interviews, isLoading } = useQuery({
    queryKey: ["interviews", { status: statusFilter }],
    queryFn: () => listInterviews({ status: statusFilter === "ALL" ? null : statusFilter }),
  });
  const { data: applications } = useQuery({ queryKey: ["applications", {}], queryFn: () => listApplications() });
  const { data: candidates } = useQuery({ queryKey: ["candidates", ""], queryFn: () => listCandidates() });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });
  const { getLabel } = useJobPostingLookup();

  const normalizedSearch = search.trim().toLowerCase();
  const filteredInterviews = interviews?.filter((interview) => {
    if (campusFilter !== "ALL" && interview.campus_id !== campusFilter) return false;
    if (myInterviewsOnly && !(user && interview.panel_member_ids.includes(user.id))) return false;
    if (!normalizedSearch) return true;
    const application = applications?.find((a) => a.id === interview.application_id);
    const candidate = application ? candidates?.find((c) => c.id === application.candidate_id) : undefined;
    const label = application ? getLabel(application.job_posting_id) : undefined;
    return (
      (candidate?.full_name.toLowerCase().includes(normalizedSearch) ?? false) ||
      (label?.positionTitle.toLowerCase().includes(normalizedSearch) ?? false)
    );
  });

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

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-72">
          <Input
            placeholder="Search by candidate or position"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-56">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as InterviewScheduleStatus | "ALL")}>
            <SelectTrigger aria-label="Status filter">
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
        <div className="w-56">
          <Select value={campusFilter} onValueChange={setCampusFilter}>
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
        <Button
          type="button"
          variant={myInterviewsOnly ? "default" : "outline"}
          onClick={() => setMyInterviewsOnly((prev) => !prev)}
        >
          My interviews only
        </Button>
      </div>

      {/* UI redesign Phase 3 -- one Card boundary shared by the loading/
          empty/table states, not just the loaded table. */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : !filteredInterviews || filteredInterviews.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {interviews && interviews.length > 0
                ? "No interviews match these filters."
                : "No interviews in this scope yet."}
            </p>
          ) : (
            <div className="overflow-x-auto">
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
                  {filteredInterviews.map((interview) => {
                    const application = applications?.find((a) => a.id === interview.application_id);
                    const candidate = application
                      ? candidates?.find((c) => c.id === application.candidate_id)
                      : undefined;
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
