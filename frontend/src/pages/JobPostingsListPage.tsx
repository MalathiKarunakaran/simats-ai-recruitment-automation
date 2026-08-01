import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listCampuses } from "@/api/campuses";
import { listDepartments } from "@/api/departments";
import { listJobPostings } from "@/api/jobPostings";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ActiveFilter = "ALL" | "ACTIVE" | "CLOSED";

export function JobPostingsListPage() {
  const { data: jobPostings, isLoading } = useQuery({ queryKey: ["job-postings"], queryFn: listJobPostings });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });
  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: listDepartments });

  const [statusFilter, setStatusFilter] = useState<ActiveFilter>("ALL");
  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");

  const normalizedSearch = search.trim().toLowerCase();
  const filteredJobPostings = jobPostings?.filter((jp) => {
    if (statusFilter === "ACTIVE" && !jp.is_active) return false;
    if (statusFilter === "CLOSED" && jp.is_active) return false;
    if (campusFilter !== "ALL" && jp.campus_id !== campusFilter) return false;
    if (!normalizedSearch) return true;
    return jp.position_title.toLowerCase().includes(normalizedSearch);
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Job Postings</h1>

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

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !filteredJobPostings || filteredJobPostings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {jobPostings && jobPostings.length > 0
            ? "No job postings match these filters."
            : "No job postings in this scope yet."}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 font-medium">Job Position</th>
              <th className="py-2 font-medium">Department</th>
              <th className="py-2 font-medium">Campus</th>
              <th className="py-2 font-medium">Available</th>
              <th className="py-2 font-medium">Required</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Published</th>
            </tr>
          </thead>
          <tbody>
            {filteredJobPostings.map((jp) => {
              const campus = campuses?.find((c) => c.id === jp.campus_id);
              const department = departments?.find((d) => d.id === jp.department_id);
              return (
                <tr key={jp.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="py-2">
                    <Link to={`/job-postings/${jp.id}`} className="font-medium hover:underline">
                      {jp.position_title}
                    </Link>
                  </td>
                  <td className="py-2">{department?.name ?? "—"}</td>
                  <td className="py-2 font-mono text-xs">{campus?.code ?? "—"}</td>
                  <td className="py-2">{jp.available_count}</td>
                  <td className="py-2">{jp.required_count}</td>
                  <td className="py-2">
                    <Badge variant={jp.is_active ? "success" : "outline"}>
                      {jp.is_active ? "Active" : "Closed"}
                    </Badge>
                  </td>
                  <td className="py-2">{new Date(jp.published_at).toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
