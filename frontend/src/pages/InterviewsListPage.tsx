import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, CalendarClock, CalendarDays, CalendarX } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listApplications } from "@/api/applications";
import { listCampuses } from "@/api/campuses";
import { listCandidates } from "@/api/candidates";
import { listInterviews } from "@/api/interviews";
import type { InterviewScheduleStatus } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { StatTile } from "@/components/dashboard/StatTile";
import { InterviewsCalendar } from "@/components/interviews/InterviewsCalendar";
import { StatusBadge } from "@/components/interviews/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

const STATUSES: InterviewScheduleStatus[] = ["SCHEDULED", "COMPLETED", "CANCELLED", "RESCHEDULED"];
const CAN_CREATE_ROLES = ["RECRUITMENT_OFFICER", "HR_ADMIN", "SUPER_ADMIN"];

const TOTAL_COLUMN_COUNT = 5;

// KPI strip's "cancelled/rescheduled" bucket -- CANCELLED and RESCHEDULED
// are the two non-"still on the calendar", non-"already happened" outcomes
// of InterviewScheduleStatus, grouped into one tile per this step's brief
// ("total, scheduled (upcoming), completed, cancelled/rescheduled"). Every
// InterviewScheduleStatus maps to exactly one of these 4 tiles, so
// scheduled+completed+cancelledOrRescheduled always equals total.
const CANCELLED_OR_RESCHEDULED_STATUSES: InterviewScheduleStatus[] = ["CANCELLED", "RESCHEDULED"];

type ViewMode = "list" | "calendar";

const VIEW_TABS: { value: ViewMode; label: string }[] = [
  { value: "list", label: "List" },
  { value: "calendar", label: "Calendar" },
];

export function InterviewsListPage() {
  const { user, hasPermission } = useAuth();
  const [statusFilter, setStatusFilter] = useState<InterviewScheduleStatus | "ALL">("ALL");
  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [myInterviewsOnly, setMyInterviewsOnly] = useState(false);
  // Defaults to "list" -- unchanged behavior for every existing user of this
  // page. "calendar" (month-grid) was explicitly deferred since Step 6 of
  // the earlier UI refinement epic; now built per direct user request.
  const [view, setView] = useState<ViewMode>("list");

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

  // KPI strip -- derived from `filteredInterviews`, the exact rows the
  // table below renders, so every tile reflects the status/campus/search/
  // "my interviews only" filters currently applied (same convention as the
  // KPI strips added to CandidatesListPage/ApplicationsListPage in this
  // same step).
  const interviewRows = filteredInterviews ?? [];
  const scheduledCount = interviewRows.filter((i) => i.status === "SCHEDULED").length;
  const completedCount = interviewRows.filter((i) => i.status === "COMPLETED").length;
  const cancelledOrRescheduledCount = interviewRows.filter((i) =>
    CANCELLED_OR_RESCHEDULED_STATUSES.includes(i.status),
  ).length;

  // Same candidate-resolution join the list rows below already do -- shared
  // with InterviewsCalendar via a resolver function so it never needs to
  // re-fetch applications/candidates of its own.
  function resolveCandidateName(interview: (typeof interviewRows)[number]): string {
    const application = applications?.find((a) => a.id === interview.application_id);
    const candidate = application ? candidates?.find((c) => c.id === application.candidate_id) : undefined;
    return candidate?.full_name ?? "Unknown candidate";
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Interviews</h1>
        {/* Bug fix: OR'd with hasPermission("SCHEDULE_INTERVIEW") -- create_interview
            is gated by require_permission(SCHEDULE_INTERVIEW), not this role list
            alone (same pattern as UsersListPage's canManage). */}
        {user && (CAN_CREATE_ROLES.includes(user.role) || hasPermission?.("SCHEDULE_INTERVIEW")) ? (
          <Button asChild>
            <Link to="/interviews/new">Schedule interview</Link>
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Total interviews" value={interviewRows.length} isLoading={isLoading} icon={CalendarDays} iconColor="blue" />
        <StatTile label="Scheduled" value={scheduledCount} isLoading={isLoading} icon={CalendarClock} iconColor="purple" />
        <StatTile label="Completed" value={completedCount} isLoading={isLoading} accent="green" icon={CalendarCheck} iconColor="green" />
        <StatTile
          label="Cancelled / Rescheduled"
          value={cancelledOrRescheduledCount}
          isLoading={isLoading}
          icon={CalendarX}
          iconColor="red"
        />
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

      <Tabs value={view} onValueChange={setView} tabs={VIEW_TABS} />

      {view === "calendar" ? (
        // Month-grid calendar (deferred since Step 6 of the earlier UI
        // refinement epic, now built per explicit user request). Renders
        // from the exact same `filteredInterviews` array the list below
        // computes -- status/campus/search/"my interviews only" all still
        // apply, just further split out by day within the visible month.
        <InterviewsCalendar
          interviews={filteredInterviews ?? []}
          isLoading={isLoading}
          resolveCandidateName={resolveCandidateName}
        />
      ) : (
        /* UI redesign Phase 3 -- one Card boundary shared by the loading/
           empty/table states, not just the loaded table. Design-system-
           foundation step 6: the hand-rolled <table>/<thead>/<tbody> markup
           itself is now the shared Table primitive (see components/ui/table.tsx),
           same swap SanctionedStrengthPage/VacancyRequestsListPage made in
           steps 4-5 -- every column's exact content/formatting carries over
           unchanged, only the element names changed. */
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableEmpty colSpan={TOTAL_COLUMN_COUNT} loading />
                ) : !filteredInterviews || filteredInterviews.length === 0 ? (
                  <TableEmpty colSpan={TOTAL_COLUMN_COUNT}>
                    {interviews && interviews.length > 0
                      ? "No interviews match these filters."
                      : "No interviews in this scope yet."}
                  </TableEmpty>
                ) : (
                  filteredInterviews.map((interview) => {
                    const application = applications?.find((a) => a.id === interview.application_id);
                    const candidate = application
                      ? candidates?.find((c) => c.id === application.candidate_id)
                      : undefined;
                    const label = application ? getLabel(application.job_posting_id) : undefined;
                    return (
                      <TableRow key={interview.id}>
                        <TableCell>
                          <Link to={`/interviews/${interview.id}`} className="font-medium hover:underline">
                            {candidate?.full_name ?? "Unknown candidate"}
                          </Link>
                          <div className="text-xs text-muted-foreground">{candidate?.email}</div>
                        </TableCell>
                        <TableCell>{label?.positionTitle ?? "—"}</TableCell>
                        <TableCell>{interview.interview_type.replace(/_/g, " ")}</TableCell>
                        <TableCell>{new Date(interview.scheduled_at).toLocaleString()}</TableCell>
                        <TableCell>
                          <StatusBadge status={interview.status} />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
