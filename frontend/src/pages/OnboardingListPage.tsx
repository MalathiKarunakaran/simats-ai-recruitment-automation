import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listApplications } from "@/api/applications";
import { listCampuses } from "@/api/campuses";
import { listCandidates } from "@/api/candidates";
import type { ApplicationStatus } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge } from "@/components/applications/StatusBadge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

const CAN_VIEW_ROLES = ["HR_ADMIN", "RECRUITMENT_OFFICER", "SUPER_ADMIN"];
const ONBOARDING_STATUSES: ApplicationStatus[] = [
  "JOINING_CONFIRMED",
  "JOINED",
  "DEPARTMENT_ROOM_ALLOTTED",
  "ORIENTATION_COMPLETE",
];

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

  const [stageFilter, setStageFilter] = useState<ApplicationStatus | "ALL">("ALL");
  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");

  const joiningConfirmedQuery = useQuery({
    queryKey: ["applications", { status: "JOINING_CONFIRMED" }],
    queryFn: () => listApplications({ status: "JOINING_CONFIRMED" }),
    enabled: canView,
  });
  const joinedQuery = useQuery({
    queryKey: ["applications", { status: "JOINED" }],
    queryFn: () => listApplications({ status: "JOINED" }),
    enabled: canView,
  });
  const departmentRoomAllottedQuery = useQuery({
    queryKey: ["applications", { status: "DEPARTMENT_ROOM_ALLOTTED" }],
    queryFn: () => listApplications({ status: "DEPARTMENT_ROOM_ALLOTTED" }),
    enabled: canView,
  });
  const orientationCompleteQuery = useQuery({
    queryKey: ["applications", { status: "ORIENTATION_COMPLETE" }],
    queryFn: () => listApplications({ status: "ORIENTATION_COMPLETE" }),
    enabled: canView,
  });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses, enabled: canView });

  if (!canView) {
    return (
      <p className="text-sm text-muted-foreground">
        Only a Recruitment Officer, HR Admin, or Super Admin can view onboarding.
      </p>
    );
  }

  const isLoading =
    joiningConfirmedQuery.isLoading ||
    joinedQuery.isLoading ||
    departmentRoomAllottedQuery.isLoading ||
    orientationCompleteQuery.isLoading;
  const applications = [
    ...(joiningConfirmedQuery.data ?? []),
    ...(joinedQuery.data ?? []),
    ...(departmentRoomAllottedQuery.data ?? []),
    ...(orientationCompleteQuery.data ?? []),
  ];

  const normalizedSearch = search.trim().toLowerCase();
  const filteredApplications = applications.filter((application) => {
    if (stageFilter !== "ALL" && application.status !== stageFilter) return false;
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
              {ONBOARDING_STATUSES.map((status) => (
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
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filteredApplications.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {applications.length > 0
            ? "No one in the onboarding pipeline matches these filters."
            : "No one is in the onboarding pipeline right now."}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 font-medium">Candidate</th>
              <th className="py-2 font-medium">Position</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Last updated</th>
            </tr>
          </thead>
          <tbody>
            {filteredApplications.map((application) => {
              const candidate = candidates?.find((c) => c.id === application.candidate_id);
              const label = getLabel(application.job_posting_id);
              return (
                <tr key={application.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="py-2">
                    <Link to={`/applications/${application.id}`} className="font-medium hover:underline">
                      {candidate?.full_name ?? "Unknown candidate"}
                    </Link>
                  </td>
                  <td className="py-2">{label?.positionTitle ?? "—"}</td>
                  <td className="py-2">
                    <StatusBadge status={application.status} />
                  </td>
                  <td className="py-2">{new Date(application.updated_at).toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
