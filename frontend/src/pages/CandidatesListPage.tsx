import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listCandidates } from "@/api/candidates";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const CAN_CREATE_ROLES = ["RECRUITMENT_OFFICER", "HR_ADMIN", "SUPER_ADMIN"];

export function CandidatesListPage() {
  const { user } = useAuth();
  const [emailFilter, setEmailFilter] = useState("");

  const { data: candidates, isLoading } = useQuery({
    queryKey: ["candidates", emailFilter],
    queryFn: () => listCandidates(emailFilter || undefined),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Candidates</h1>
        {user && CAN_CREATE_ROLES.includes(user.role) ? (
          <Button asChild>
            <Link to="/candidates/new">New candidate</Link>
          </Button>
        ) : null}
      </div>

      <div className="w-72">
        <Input
          placeholder="Search by email"
          value={emailFilter}
          onChange={(e) => setEmailFilter(e.target.value)}
        />
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
                <td className="py-2">{new Date(candidate.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
