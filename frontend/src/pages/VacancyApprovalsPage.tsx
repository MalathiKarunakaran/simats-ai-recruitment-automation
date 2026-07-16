import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { listCampuses } from "@/api/campuses";
import type { UserRole, VacancyRequestStatus } from "@/api/types";
import { listVacancyRequests } from "@/api/vacancyRequests";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge } from "@/components/vacancy-requests/StatusBadge";

// Mirrors the backend's own approval-chain role groupings
// (app/models/enums.py::VACANCY_APPROVAL_DEAN_ROLES / VACANCY_APPROVAL_HR_ROLES):
// which statuses actually need *this* role's action next.
const ACTIONABLE_STATUSES_BY_ROLE: Record<string, VacancyRequestStatus[]> = {
  ASSOCIATE_DEAN_RECRUITMENT: ["SUBMITTED"],
  HR_ADMIN: ["DEAN_APPROVED", "APPROVED"],
  SUPER_ADMIN: ["SUBMITTED", "DEAN_APPROVED", "APPROVED"],
};

const STATUS_ACTION_LABEL: Record<VacancyRequestStatus, string> = {
  DRAFT: "",
  SUBMITTED: "Needs dean approval",
  DEAN_APPROVED: "Needs HR approval",
  APPROVED: "Ready to publish",
  PUBLISHED: "",
  CLOSED: "",
  REJECTED: "",
};

export function VacancyApprovalsPage() {
  const { user } = useAuth();
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });

  const statuses = (user && ACTIONABLE_STATUSES_BY_ROLE[user.role as UserRole]) ?? [];

  // Unrolled per-status queries (not `.map(() => useQuery(...))`) so hook
  // calls stay static -- same pattern as the Dashboard's category split.
  const submittedQuery = useQuery({
    queryKey: ["vacancy-requests", "SUBMITTED"],
    queryFn: () => listVacancyRequests("SUBMITTED"),
    enabled: statuses.includes("SUBMITTED"),
  });
  const deanApprovedQuery = useQuery({
    queryKey: ["vacancy-requests", "DEAN_APPROVED"],
    queryFn: () => listVacancyRequests("DEAN_APPROVED"),
    enabled: statuses.includes("DEAN_APPROVED"),
  });
  const approvedQuery = useQuery({
    queryKey: ["vacancy-requests", "APPROVED"],
    queryFn: () => listVacancyRequests("APPROVED"),
    enabled: statuses.includes("APPROVED"),
  });

  const isLoading =
    (statuses.includes("SUBMITTED") && submittedQuery.isLoading) ||
    (statuses.includes("DEAN_APPROVED") && deanApprovedQuery.isLoading) ||
    (statuses.includes("APPROVED") && approvedQuery.isLoading);

  const queue = [...(submittedQuery.data ?? []), ...(deanApprovedQuery.data ?? []), ...(approvedQuery.data ?? [])];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Vacancy Approvals</h1>
        <p className="text-sm text-muted-foreground">Vacancy requests waiting on your approval.</p>
      </div>

      {statuses.length === 0 ? (
        <p className="text-sm text-muted-foreground">Your role doesn't take part in the approval chain.</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : queue.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing is waiting on your approval right now.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 font-medium">Position</th>
              <th className="py-2 font-medium">Campus</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Next action</th>
              <th className="py-2 font-medium">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((vr) => {
              const campus = campuses?.find((c) => c.id === vr.campus_id);
              return (
                <tr key={vr.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="py-2">
                    <Link to={`/vacancy-requests/${vr.id}`} className="font-medium hover:underline">
                      {vr.position_title}
                    </Link>
                  </td>
                  <td className="py-2 font-mono text-xs">{campus?.code ?? "—"}</td>
                  <td className="py-2">
                    <StatusBadge status={vr.status} />
                  </td>
                  <td className="py-2 text-muted-foreground">{STATUS_ACTION_LABEL[vr.status]}</td>
                  <td className="py-2">{new Date(vr.created_at).toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
