import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listCampuses } from "@/api/campuses";
import { listDepartments } from "@/api/departments";
import { listJobPostings } from "@/api/jobPostings";
import type { JobPostingRead } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CategoryTabs } from "@/components/domain/CategoryTabs";
import { useCategoryTabState } from "@/hooks/useCategoryTabState";

type ActiveFilter = "ALL" | "ACTIVE" | "CLOSED";

const TOTAL_COLUMN_COUNT = 7;

export function JobPostingsListPage() {
  const { data: jobPostings, isLoading } = useQuery({ queryKey: ["job-postings"], queryFn: listJobPostings });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });
  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: listDepartments });

  const [statusFilter, setStatusFilter] = useState<ActiveFilter>("ALL");
  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  // URL-persisted via ?category=... (see hooks/useCategoryTabState.ts) so
  // the selection survives refresh/back-forward/shared links.
  const [categoryTab, setCategoryTab] = useCategoryTabState();

  const normalizedSearch = search.trim().toLowerCase();

  // Every filter except the category tab -- shared between the final
  // filtered list and the CategoryTabs counts, so each tab's count reflects
  // "how many in this category, given the *other* active filters", not the
  // whole unfiltered list.
  function matchesNonCategoryFilters(jp: JobPostingRead): boolean {
    if (statusFilter === "ACTIVE" && !jp.is_active) return false;
    if (statusFilter === "CLOSED" && jp.is_active) return false;
    if (campusFilter !== "ALL" && jp.campus_id !== campusFilter) return false;
    if (!normalizedSearch) return true;
    return jp.position_title.toLowerCase().includes(normalizedSearch);
  }

  const preCategoryFiltered = (jobPostings ?? []).filter(matchesNonCategoryFilters);
  const categoryTabCounts = {
    all: preCategoryFiltered.length,
    teaching: preCategoryFiltered.filter((jp) => jp.role_category === "TEACHING").length,
    nonTeaching: preCategoryFiltered.filter((jp) => jp.role_category === "NON_TEACHING").length,
    housekeeping: preCategoryFiltered.filter((jp) => jp.role_category === "HOUSEKEEPING").length,
  };
  const filteredJobPostings = jobPostings
    ? preCategoryFiltered.filter((jp) => categoryTab === "ALL" || jp.role_category === categoryTab)
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Job Postings</h1>

      <CategoryTabs value={categoryTab} onValueChange={setCategoryTab} counts={categoryTabCounts} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-72">
          <Input
            placeholder="Search by position title"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-56">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ActiveFilter)}>
            <SelectTrigger aria-label="Status filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="CLOSED">Closed</SelectItem>
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
          empty/table states, not just the loaded table. */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job Position</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Campus</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Available</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Published</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableEmpty colSpan={TOTAL_COLUMN_COUNT} loading />
              ) : !filteredJobPostings || filteredJobPostings.length === 0 ? (
                <TableEmpty colSpan={TOTAL_COLUMN_COUNT}>
                  {jobPostings && jobPostings.length > 0
                    ? "No job postings match these filters."
                    : "No job postings in this scope yet."}
                </TableEmpty>
              ) : (
                filteredJobPostings.map((jp) => {
                  const campus = campuses?.find((c) => c.id === jp.campus_id);
                  const department = departments?.find((d) => d.id === jp.department_id);
                  return (
                    <TableRow key={jp.id}>
                      <TableCell>
                        <Link to={`/job-postings/${jp.id}`} className="font-medium hover:underline">
                          {jp.position_title}
                        </Link>
                      </TableCell>
                      <TableCell>{department?.name ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{campus?.code ?? "—"}</TableCell>
                      <TableCell>{jp.requested_count}</TableCell>
                      <TableCell>{jp.available_count}</TableCell>
                      <TableCell>
                        <Badge variant={jp.is_active ? "success" : "outline"}>
                          {jp.is_active ? "Active" : "Closed"}
                        </Badge>
                      </TableCell>
                      <TableCell>{new Date(jp.published_at).toLocaleDateString()}</TableCell>
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
