import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listApplications } from "@/api/applications";
import { listCandidates } from "@/api/candidates";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge } from "@/components/candidates/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

export function CandidatesListPage() {
  const { user } = useAuth();
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Candidates</h1>
        {user && CAN_MANAGE_CANDIDATES_ROLES.includes(user.role) ? (
          <Button asChild>
            <Link to="/candidates/new">New candidate</Link>
          </Button>
        ) : null}
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
          empty/table states, not just the loaded table. */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : !filteredCandidates || filteredCandidates.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {candidates && candidates.length > 0 ? "No candidates match these filters." : "No candidates found."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 font-medium">Name</th>
                    <th className="py-2 font-medium">Email</th>
                    <th className="py-2 font-medium">Phone</th>
                    <th className="py-2 font-medium">Source</th>
                    <th className="py-2 font-medium">Resume</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCandidates.map((candidate) => (
                    <tr key={candidate.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                      <td className="py-2">
                        <Link to={`/candidates/${candidate.id}`} className="font-medium hover:underline">
                          {candidate.full_name}
                        </Link>
                      </td>
                      <td className="py-2">{candidate.email}</td>
                      <td className="py-2">{candidate.phone_number ?? "—"}</td>
                      <td className="py-2">{candidate.source ?? "—"}</td>
                      <td className="py-2">{candidate.resume_storage_key ? "Yes" : "No"}</td>
                      <td className="py-2">
                        <StatusBadge status={candidate.is_withdrawn} />
                      </td>
                      <td className="py-2">{new Date(candidate.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
