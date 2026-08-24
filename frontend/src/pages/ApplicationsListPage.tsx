import { useQuery } from "@tanstack/react-query";
import { Award, ClipboardList, LogIn, Search, XCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listApplications } from "@/api/applications";
import { listCampuses } from "@/api/campuses";
import { listCandidates } from "@/api/candidates";
import { APPLICATION_STATUS_ORDER } from "@/api/types";
import type { ApplicationRead, ApplicationStatus } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge } from "@/components/applications/StatusBadge";
import { StatTile } from "@/components/dashboard/StatTile";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CategoryTabs } from "@/components/domain/CategoryTabs";
import { useCategoryTabState } from "@/hooks/useCategoryTabState";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

const CAN_CREATE_ROLES = ["RECRUITMENT_OFFICER", "HR_ADMIN", "SUPER_ADMIN", "RECRUITMENT_COORDINATOR"];

const TOTAL_COLUMN_COUNT = 4;

// Step 6 KPI strip's funnel buckets -- a fresh, page-local grouping over
// ApplicationStatus (mirrors APPLICATION_STATUS_ORDER's own forward
// progression, api/types.ts), deliberately NOT the same computation as
// DashboardPage's `application_pipeline_funnel` (that's a dedicated
// dashboard-summary endpoint field computed server-side; reusing it here
// would mean a new backend call, out of scope for this step). This page
// already fetches every Application row it needs for its own filters, so
// these buckets are just a client-side reduction over that same data --
// every ApplicationStatus maps to exactly one bucket, so
// inReview+selectedOrOffer+joined+rejectedOrWithdrawn+APPLIED always sums to
// total (asserted in ApplicationsListPage.test.tsx).
const IN_REVIEW_STATUSES: ApplicationStatus[] = ["SCREENING", "CALLED_FOR_INTERVIEW", "INTERVIEWED"];
const SELECTED_OR_OFFER_STATUSES: ApplicationStatus[] = ["SELECTED", "OFFER_SENT", "OFFER_ACCEPTED", "JOINING_CONFIRMED"];
const JOINED_STATUSES: ApplicationStatus[] = [
  "JOINED",
  "DEPARTMENT_ROOM_ALLOTTED",
  "ORIENTATION_COMPLETE",
  "HANDED_OVER_TO_HOD",
];
const REJECTED_OR_WITHDRAWN_STATUSES: ApplicationStatus[] = ["REJECTED", "WITHDRAWN"];

export function ApplicationsListPage() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "ALL">("ALL");
  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  // URL-persisted via ?category=... (see hooks/useCategoryTabState.ts) so
  // the selection survives refresh/back-forward/shared links.
  const [categoryTab, setCategoryTab] = useCategoryTabState();

  const { data: applications, isLoading } = useQuery({
    queryKey: ["applications", { status: statusFilter }],
    queryFn: () => listApplications({ status: statusFilter === "ALL" ? null : statusFilter }),
  });
  const { data: candidates } = useQuery({ queryKey: ["candidates", ""], queryFn: () => listCandidates() });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });
  const { getLabel } = useJobPostingLookup();

  const normalizedSearch = search.trim().toLowerCase();

  // Every filter except the category tab (status is already server-side) --
  // shared between the final filtered list and the CategoryTabs counts, so
  // each tab's count reflects "how many in this category, given the *other*
  // active filters", not the whole unfiltered list.
  function matchesNonCategoryFilters(application: ApplicationRead): boolean {
    if (campusFilter !== "ALL" && application.campus_id !== campusFilter) return false;
    if (!normalizedSearch) return true;
    const candidate = candidates?.find((c) => c.id === application.candidate_id);
    const label = getLabel(application.job_posting_id);
    return (
      (candidate?.full_name.toLowerCase().includes(normalizedSearch) ?? false) ||
      (label?.positionTitle.toLowerCase().includes(normalizedSearch) ?? false)
    );
  }

  const preCategoryFiltered = (applications ?? []).filter(matchesNonCategoryFilters);
  const categoryTabCounts = {
    all: preCategoryFiltered.length,
    teaching: preCategoryFiltered.filter((a) => a.role_category === "TEACHING").length,
    nonTeaching: preCategoryFiltered.filter((a) => a.role_category === "NON_TEACHING").length,
    housekeeping: preCategoryFiltered.filter((a) => a.role_category === "HOUSEKEEPING").length,
  };
  const filteredApplications = applications
    ? preCategoryFiltered.filter((a) => categoryTab === "ALL" || a.role_category === categoryTab)
    : undefined;

  // KPI strip -- derived from `filteredApplications`, the exact rows the
  // table below renders, so every tile reflects the status/campus/search/
  // category filters currently applied (same convention as the KPI strip
  // added to CandidatesListPage in this same step).
  const applicationRows = filteredApplications ?? [];
  const appliedCount = applicationRows.filter((a) => a.status === "APPLIED").length;
  const inReviewCount = applicationRows.filter((a) => IN_REVIEW_STATUSES.includes(a.status)).length;
  const selectedOrOfferCount = applicationRows.filter((a) => SELECTED_OR_OFFER_STATUSES.includes(a.status)).length;
  const joinedCount = applicationRows.filter((a) => JOINED_STATUSES.includes(a.status)).length;
  const rejectedOrWithdrawnCount = applicationRows.filter((a) =>
    REJECTED_OR_WITHDRAWN_STATUSES.includes(a.status),
  ).length;

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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Total applications" value={applicationRows.length} isLoading={isLoading} icon={ClipboardList} iconColor="blue" />
        <StatTile label="Applied" value={appliedCount} isLoading={isLoading} />
        <StatTile label="In review" value={inReviewCount} isLoading={isLoading} icon={Search} iconColor="purple" />
        <StatTile label="Selected / Offer" value={selectedOrOfferCount} isLoading={isLoading} accent="gold" icon={Award} iconColor="orange" />
        <StatTile label="Joined" value={joinedCount} isLoading={isLoading} accent="green" icon={LogIn} iconColor="green" />
        <StatTile label="Rejected / Withdrawn" value={rejectedOrWithdrawnCount} isLoading={isLoading} icon={XCircle} iconColor="red" />
      </div>

      <CategoryTabs value={categoryTab} onValueChange={setCategoryTab} counts={categoryTabCounts} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-72">
          <Input
            placeholder="Search by candidate or position"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-56">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ApplicationStatus | "ALL")}>
            <SelectTrigger aria-label="Status filter">
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

      {/* UI redesign Phase 3 -- one Card boundary shared by the loading/
          empty/table states, not just the loaded table. Design-system-
          foundation step 6: the hand-rolled <table>/<thead>/<tbody> markup
          itself is now the shared Table primitive (see components/ui/table.tsx),
          same swap SanctionedStrengthPage/VacancyRequestsListPage made in
          steps 4-5 -- every column's exact content/formatting carries over
          unchanged, only the element names changed. */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Candidate</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Applied</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableEmpty colSpan={TOTAL_COLUMN_COUNT} loading />
              ) : !filteredApplications || filteredApplications.length === 0 ? (
                <TableEmpty colSpan={TOTAL_COLUMN_COUNT}>
                  {applications && applications.length > 0
                    ? "No applications match these filters."
                    : "No applications in this scope yet."}
                </TableEmpty>
              ) : (
                filteredApplications.map((application) => {
                  const candidate = candidates?.find((c) => c.id === application.candidate_id);
                  const label = getLabel(application.job_posting_id);
                  return (
                    <TableRow key={application.id}>
                      <TableCell>
                        <Link to={`/applications/${application.id}`} className="font-medium hover:underline">
                          {candidate?.full_name ?? "Unknown candidate"}
                        </Link>
                        <div className="text-xs text-muted-foreground">{candidate?.email}</div>
                      </TableCell>
                      <TableCell>{label?.positionTitle ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge status={application.status} />
                      </TableCell>
                      <TableCell>{new Date(application.applied_at).toLocaleDateString()}</TableCell>
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
