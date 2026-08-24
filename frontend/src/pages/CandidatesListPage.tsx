import { useQuery } from "@tanstack/react-query";
import { FileCheck2, UserCheck, UserMinus, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listApplications } from "@/api/applications";
import { listCandidates } from "@/api/candidates";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge } from "@/components/candidates/StatusBadge";
import { StatTile } from "@/components/dashboard/StatTile";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CategoryTabs } from "@/components/domain/CategoryTabs";
import { useCategoryTabState } from "@/hooks/useCategoryTabState";

// Mirrors the backend's RECRUITMENT_OFFICER/HR_ADMIN/SUPER_ADMIN/
// RECRUITMENT_COORDINATOR gate on both candidate creation and
// POST /candidates/{id}/withdraw (app/api/v1/routers/candidates.py) --
// routine candidate management, not HR-exclusive like employee offboarding.
// Shared with CandidateDetailPage.
export const CAN_MANAGE_CANDIDATES_ROLES = ["RECRUITMENT_OFFICER", "HR_ADMIN", "SUPER_ADMIN", "RECRUITMENT_COORDINATOR"];

type StatusFilter = "ACTIVE" | "WITHDRAWN" | "ALL";
type ResumeFilter = "ALL" | "MISSING" | "UPLOADED";

const TOTAL_COLUMN_COUNT = 7;

export function CandidatesListPage() {
  const { user, hasPermission } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [resumeFilter, setResumeFilter] = useState<ResumeFilter>("ALL");
  // URL-persisted via ?category=... (see hooks/useCategoryTabState.ts) so
  // the selection survives refresh/back-forward/shared links. A candidate
  // has no direct category column of its own -- one candidate can apply
  // across multiple job postings, possibly in different categories -- so
  // this tab's semantics are "has at least one application whose
  // role_category matches the selected tab" (an "any", not "every", match;
  // a candidate with both a Teaching and a Non-Teaching application shows
  // up under both tabs). Requires fetching Applications alongside Candidates
  // for this page specifically -- everywhere else on this page already
  // fetches only Candidates.
  const [categoryTab, setCategoryTab] = useCategoryTabState();

  const isWithdrawn = statusFilter === "ALL" ? undefined : statusFilter === "WITHDRAWN";

  // Only the status filter goes server-side (the backend's `email` param is
  // an exact-column-only ilike match) -- name matching and the resume
  // filter are client-side, same pattern as EmployeesListPage.
  const { data: candidates, isLoading } = useQuery({
    queryKey: ["candidates", isWithdrawn],
    queryFn: () => listCandidates(undefined, isWithdrawn),
  });
  // Only fetched for the category tab's "any application in this category"
  // check -- ≤200 rows, same fetch-everything-unfiltered convention as
  // ApplicationsListPage/VacancyRequestsListPage use for client-side filters.
  const { data: applications } = useQuery({
    queryKey: ["applications", "for-category-tab"],
    queryFn: () => listApplications(),
  });

  const categoriesByCandidateId = new Map<string, Set<string>>();
  (applications ?? []).forEach((application) => {
    if (!categoriesByCandidateId.has(application.candidate_id)) {
      categoriesByCandidateId.set(application.candidate_id, new Set());
    }
    categoriesByCandidateId.get(application.candidate_id)!.add(application.role_category);
  });

  const normalizedSearch = search.trim().toLowerCase();

  // Every filter except the category tab -- shared between the final
  // filtered list and the CategoryTabs counts, so each tab's count reflects
  // "how many in this category, given the *other* active filters", not the
  // whole unfiltered list.
  function matchesNonCategoryFilters(candidate: NonNullable<typeof candidates>[number]): boolean {
    if (resumeFilter === "MISSING" && candidate.resume_storage_key) return false;
    if (resumeFilter === "UPLOADED" && !candidate.resume_storage_key) return false;
    if (!normalizedSearch) return true;
    return (
      candidate.full_name.toLowerCase().includes(normalizedSearch) ||
      candidate.email.toLowerCase().includes(normalizedSearch)
    );
  }

  const preCategoryFiltered = (candidates ?? []).filter(matchesNonCategoryFilters);
  function hasApplicationInCategory(candidateId: string, category: string): boolean {
    return categoriesByCandidateId.get(candidateId)?.has(category) ?? false;
  }
  const categoryTabCounts = {
    all: preCategoryFiltered.length,
    teaching: preCategoryFiltered.filter((c) => hasApplicationInCategory(c.id, "TEACHING")).length,
    nonTeaching: preCategoryFiltered.filter((c) => hasApplicationInCategory(c.id, "NON_TEACHING")).length,
    housekeeping: preCategoryFiltered.filter((c) => hasApplicationInCategory(c.id, "HOUSEKEEPING")).length,
  };
  const filteredCandidates = candidates
    ? preCategoryFiltered.filter((c) => categoryTab === "ALL" || hasApplicationInCategory(c.id, categoryTab))
    : undefined;

  // Step 6 KPI strip -- derived from `filteredCandidates`, i.e. the exact
  // rows the table below renders, so every tile reflects the search/status/
  // resume/category filters currently applied (same "don't show a static
  // unfiltered count next to a filtered table" rule CategoryTabs' own counts
  // already follow above). No new fetch: both fields these tiles read
  // (is_withdrawn, resume_storage_key) are already on CandidateRead and
  // already part of the `candidates` query this page fetches regardless.
  const candidateRows = filteredCandidates ?? [];
  const activeCandidateCount = candidateRows.filter((c) => !c.is_withdrawn).length;
  const withdrawnCandidateCount = candidateRows.filter((c) => c.is_withdrawn).length;
  const resumeUploadedCount = candidateRows.filter((c) => c.resume_storage_key).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Candidates</h1>
        {/* Bug fix: OR'd with hasPermission("CREATE_CANDIDATE") -- candidates.py's
            create_candidate is gated by require_permission, not this role list
            alone (same pattern as UsersListPage's canManage). */}
        {user && (CAN_MANAGE_CANDIDATES_ROLES.includes(user.role) || hasPermission?.("CREATE_CANDIDATE")) ? (
          <Button asChild>
            <Link to="/candidates/new">New candidate</Link>
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Total candidates"
          value={candidateRows.length}
          isLoading={isLoading}
          icon={Users}
          iconColor="blue"
        />
        <StatTile
          label="Active"
          value={activeCandidateCount}
          isLoading={isLoading}
          accent="green"
          icon={UserCheck}
          iconColor="green"
        />
        <StatTile
          label="Withdrawn"
          value={withdrawnCandidateCount}
          isLoading={isLoading}
          icon={UserMinus}
          iconColor="red"
        />
        <StatTile
          label="Resume uploaded"
          value={resumeUploadedCount}
          isLoading={isLoading}
          icon={FileCheck2}
          iconColor="purple"
        />
      </div>

      <CategoryTabs value={categoryTab} onValueChange={setCategoryTab} counts={categoryTabCounts} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-72">
          <Input
            placeholder="Search by name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-56">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger aria-label="Status filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="WITHDRAWN">Withdrawn</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-56">
          <Select value={resumeFilter} onValueChange={(v) => setResumeFilter(v as ResumeFilter)}>
            <SelectTrigger aria-label="Resume filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Resume: All</SelectItem>
              <SelectItem value="MISSING">Resume: Missing</SelectItem>
              <SelectItem value="UPLOADED">Resume: Uploaded</SelectItem>
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
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Resume</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableEmpty colSpan={TOTAL_COLUMN_COUNT} loading />
              ) : !filteredCandidates || filteredCandidates.length === 0 ? (
                <TableEmpty colSpan={TOTAL_COLUMN_COUNT}>
                  {candidates && candidates.length > 0 ? "No candidates match these filters." : "No candidates found."}
                </TableEmpty>
              ) : (
                filteredCandidates.map((candidate) => (
                  <TableRow key={candidate.id}>
                    <TableCell>
                      <Link to={`/candidates/${candidate.id}`} className="font-medium hover:underline">
                        {candidate.full_name}
                      </Link>
                    </TableCell>
                    <TableCell>{candidate.email}</TableCell>
                    <TableCell>{candidate.phone_number ?? "—"}</TableCell>
                    <TableCell>{candidate.source ?? "—"}</TableCell>
                    <TableCell>{candidate.resume_storage_key ? "Yes" : "No"}</TableCell>
                    <TableCell>
                      <StatusBadge status={candidate.is_withdrawn} />
                    </TableCell>
                    <TableCell>{new Date(candidate.created_at).toLocaleDateString()}</TableCell>
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
