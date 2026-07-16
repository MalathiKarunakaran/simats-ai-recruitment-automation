import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { listApplications } from "@/api/applications";
import { listCandidates } from "@/api/candidates";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge } from "@/components/applications/StatusBadge";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

const CAN_VIEW_ROLES = ["HR_ADMIN", "RECRUITMENT_OFFICER", "SUPER_ADMIN"];

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

  const joiningPendingQuery = useQuery({
    queryKey: ["applications", { status: "JOINING_PENDING" }],
    queryFn: () => listApplications({ status: "JOINING_PENDING" }),
    enabled: canView,
  });
  const joinedQuery = useQuery({
    queryKey: ["applications", { status: "JOINED" }],
    queryFn: () => listApplications({ status: "JOINED" }),
    enabled: canView,
  });
  const onboardingCompleteQuery = useQuery({
    queryKey: ["applications", { status: "ONBOARDING_COMPLETE" }],
    queryFn: () => listApplications({ status: "ONBOARDING_COMPLETE" }),
    enabled: canView,
  });

  if (!canView) {
    return (
      <p className="text-sm text-muted-foreground">
        Only a Recruitment Officer, HR Admin, or Super Admin can view onboarding.
      </p>
    );
  }

  const isLoading = joiningPendingQuery.isLoading || joinedQuery.isLoading || onboardingCompleteQuery.isLoading;
  const applications = [
    ...(joiningPendingQuery.data ?? []),
    ...(joinedQuery.data ?? []),
    ...(onboardingCompleteQuery.data ?? []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Onboarding</h1>
        <p className="text-sm text-muted-foreground">
          Candidates currently moving through joining and onboarding.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : applications.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one is in the onboarding pipeline right now.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 font-medium">Candidate</th>
              <th className="py-2 font-medium">Position</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((application) => {
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
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
