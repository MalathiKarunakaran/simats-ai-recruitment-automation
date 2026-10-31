import { useQueries, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listApplications } from "@/api/applications";
import { listCampuses } from "@/api/campuses";
import { listCandidates } from "@/api/candidates";
import { listOnboardingProbation } from "@/api/joining";
import type { ApplicationStatus } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge } from "@/components/applications/StatusBadge";
import { formatDate } from "@/components/joining/postHandover";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

// Bug fix: was missing RECRUITMENT_COORDINATOR, unlike AppShell.tsx's own
// nav entry for this exact page (visibleForRoles includes it) and
// JoiningCard.tsx's READ_ROLES for the same underlying joining-stage data
// -- a RECRUITMENT_COORDINATOR could see the "Onboarding" nav link but this
// page's own canView gate then blocked them, a stale role list rather than
// a missing-permission-fallback bug (this page's data, GET /applications,
// is broadly staff-readable on the backend, not require_permission-gated).
//
// CAMPUS_HOD added 31-Oct-2026 (docs/specs/hod-review-and-permanent-order.md,
// decision H2): an HOD records the probation review for their own campus,
// so they see just the HOD-review stages here (GET /applications and GET
// /onboarding/probation are both campus-scoped for them).
const CAN_VIEW_ROLES = ["HR_ADMIN", "RECRUITMENT_OFFICER", "SUPER_ADMIN", "RECRUITMENT_COORDINATOR", "CAMPUS_HOD"];
const TOTAL_COLUMN_COUNT = 5;
const ONBOARDING_STATUSES: ApplicationStatus[] = [
  "JOINING_CONFIRMED",
  "JOINED",
  "DEPARTMENT_ROOM_ALLOTTED",
  "PROVISIONAL_ORDER_ISSUED",
  "ORIENTATION_COMPLETE",
  // No longer the end (31-Oct): awaiting the HOD's probation review.
  "HANDED_OVER_TO_HOD",
  "HOD_REVIEW_COMPLETE",
  "PERMANENT_ORDER_ISSUED",
];
const HOD_STATUSES: ApplicationStatus[] = ["HANDED_OVER_TO_HOD", "HOD_REVIEW_COMPLETE"];

// Onboarding isn't a separate backend concept -- it's the same Application
// data filtered to the joining-stage statuses, reusing the existing
// GET /applications?status= filter (called once per status, since the
// backend only accepts one status at a time) rather than a new list
// endpoint. Actions still happen through JoiningCard on the application's
// own detail page -- this is a queue view, not a duplicate action surface.
export function OnboardingListPage() {
  const { user } = useAuth();
  const { getLabel } = useJobPostingLookup();
  const { data: candidates } = useQuery({ queryKey: ["candidates", ""], queryFn: () => listCandidates() });

  const canView = Boolean(user && CAN_VIEW_ROLES.includes(user.role));
  const stages = user?.role === "CAMPUS_HOD" ? HOD_STATUSES : ONBOARDING_STATUSES;

  const [stageFilter, setStageFilter] = useState<ApplicationStatus | "ALL">("ALL");
  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);

  // GET /applications takes one status at a time, so one query per stage.
  const stageQueries = useQueries({
    queries: stages.map((status) => ({
      queryKey: ["applications", { status }],
      queryFn: () => listApplications({ status }),
      enabled: canView,
    })),
  });
  // Joining date and probation per application, computed on the server
  // (GET /onboarding/probation): GET /applications carries neither.
  const { data: probationRows } = useQuery({
    queryKey: ["onboarding-probation"],
    queryFn: listOnboardingProbation,
    enabled: canView,
  });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses, enabled: canView });

  if (!canView) {
    return (
      <p className="text-sm text-muted-foreground">
        Only a Recruitment Officer, HR Admin, Recruitment Coordinator, Campus HOD, or Super Admin can view
        onboarding.
      </p>
    );
  }

  const isLoading = stageQueries.some((query) => query.isLoading);
  const applications = stageQueries.flatMap((query) => query.data ?? []);
  const probationById = new Map((probationRows ?? []).map((row) => [row.application_id, row]));

  const normalizedSearch = search.trim().toLowerCase();
  const filteredApplications = applications.filter((application) => {
    if (stageFilter !== "ALL" && application.status !== stageFilter) return false;
    if (overdueOnly && !probationById.get(application.id)?.past_probation_without_recommendation) return false;
    if (campusFilter !== "ALL" && application.campus_id !== campusFilter) return false;
    if (!normalizedSearch) return true;
    const candidate = candidates?.find((c) => c.id === application.candidate_id);
    const label = getLabel(application.job_posting_id);
    return (
      (candidate?.full_name.toLowerCase().includes(normalizedSearch) ?? false) ||
      (label?.positionTitle.toLowerCase().includes(normalizedSearch) ?? false)
    );
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Onboarding</h1>
        <p className="text-sm text-muted-foreground">
          Candidates currently moving through joining and onboarding.
        </p>
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
          <Select value={stageFilter} onValueChange={(v) => setStageFilter(v as ApplicationStatus | "ALL")}>
            <SelectTrigger aria-label="Stage filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All stages</SelectItem>
              {stages.map((status) => (
                <SelectItem key={status} value={status}>
                  {status.replace(/_/g, " ")}
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
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          Past probation, no HOD recommendation
        </label>
      </div>

      {/* UI redesign Phase 3 -- one Card boundary shared by the loading/
          empty/table states, not just the loaded table. */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Candidate</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Days since joining</TableHead>
                <TableHead>Last updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableEmpty colSpan={TOTAL_COLUMN_COUNT} loading />
              ) : filteredApplications.length === 0 ? (
                <TableEmpty colSpan={TOTAL_COLUMN_COUNT}>
                  {applications.length > 0
                    ? "No one in the onboarding pipeline matches these filters."
                    : "No one is in the onboarding pipeline right now."}
                </TableEmpty>
              ) : (
                filteredApplications.map((application) => {
                  const candidate = candidates?.find((c) => c.id === application.candidate_id);
                  const label = getLabel(application.job_posting_id);
                  const probation = probationById.get(application.id);
                  const overdue = Boolean(probation?.past_probation_without_recommendation);
                  return (
                    <TableRow
                      key={application.id}
                      data-overdue={overdue || undefined}
                      className={overdue ? "bg-brand-warning/10" : undefined}
                    >
                      <TableCell>
                        <Link to={`/applications/${application.id}`} className="font-medium hover:underline">
                          {candidate?.full_name ?? "Unknown candidate"}
                        </Link>
                      </TableCell>
                      <TableCell>{label?.positionTitle ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge status={application.status} />
                          {overdue && probation?.probation_end_date ? (
                            <span className="text-xs font-medium text-brand-warning">
                              Probation ended {formatDate(probation.probation_end_date)}, no HOD recommendation
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>{probation?.days_since_joining ?? "—"}</TableCell>
                      <TableCell>{new Date(application.updated_at).toLocaleDateString()}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
