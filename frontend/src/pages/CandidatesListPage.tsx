import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listCandidates } from "@/api/candidates";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge } from "@/components/candidates/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Mirrors the backend's RECRUITMENT_OFFICER/HR_ADMIN/SUPER_ADMIN gate on
// both candidate creation and POST /candidates/{id}/withdraw
// (app/api/v1/routers/candidates.py) -- routine candidate management, not
// HR-exclusive like employee offboarding. Shared with CandidateDetailPage.
export const CAN_MANAGE_CANDIDATES_ROLES = ["RECRUITMENT_OFFICER", "HR_ADMIN", "SUPER_ADMIN"];

type StatusFilter = "ACTIVE" | "WITHDRAWN" | "ALL";

export function CandidatesListPage() {
  const { user } = useAuth();
  const [emailFilter, setEmailFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  const isWithdrawn = statusFilter === "ALL" ? undefined : statusFilter === "WITHDRAWN";

  const { data: candidates, isLoading } = useQuery({
    queryKey: ["candidates", emailFilter, isWithdrawn],
    queryFn: () => listCandidates(emailFilter || undefined, isWithdrawn),
  });

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

      <div className="flex items-center gap-3">
        <div className="w-72">
          <Input
            placeholder="Search by email"
            value={emailFilter}
            onChange={(e) => setEmailFilter(e.target.value)}
          />
        </div>
        <div className="w-56">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="WITHDRAWN">Withdrawn</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !candidates || candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No candidates found.</p>
      ) : (
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
            {candidates.map((candidate) => (
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
      )}
    </div>
  );
}
