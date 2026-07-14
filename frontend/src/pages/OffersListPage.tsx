import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { listApplications } from "@/api/applications";
import { listCandidates } from "@/api/candidates";
import { listOffers } from "@/api/offers";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge } from "@/components/offers/StatusBadge";
import { Button } from "@/components/ui/button";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

const CAN_VIEW_ROLES = ["HR_ADMIN", "SUPER_ADMIN", "MANAGEMENT"];
const CAN_CREATE_ROLES = ["HR_ADMIN", "SUPER_ADMIN"];

export function OffersListPage() {
  const { user } = useAuth();
  const canView = Boolean(user && CAN_VIEW_ROLES.includes(user.role));

  const { data: offers, isLoading } = useQuery({
    queryKey: ["offers", {}],
    queryFn: () => listOffers(),
    enabled: canView,
  });
  const { data: applications } = useQuery({
    queryKey: ["applications", {}],
    queryFn: () => listApplications(),
    enabled: canView,
  });
  const { data: candidates } = useQuery({
    queryKey: ["candidates", ""],
    queryFn: () => listCandidates(),
    enabled: canView,
  });
  const { getLabel } = useJobPostingLookup();

  if (!canView) {
    return (
      <p className="text-sm text-muted-foreground">
        Only HR Admin, Super Admin, or Management can view offers.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Offers</h1>
        {user && CAN_CREATE_ROLES.includes(user.role) ? (
          <Button asChild>
            <Link to="/offers/new">Make an offer</Link>
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !offers || offers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No offers yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 font-medium">Candidate</th>
              <th className="py-2 font-medium">Position</th>
              <th className="py-2 font-medium">Salary</th>
              <th className="py-2 font-medium">Joining date</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {offers.map((offer) => {
              const application = applications?.find((a) => a.id === offer.application_id);
              const candidate = application ? candidates?.find((c) => c.id === application.candidate_id) : undefined;
              const label = application ? getLabel(application.job_posting_id) : undefined;
              return (
                <tr key={offer.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="py-2">
                    <Link to={`/offers/${offer.id}`} className="font-medium hover:underline">
                      {candidate?.full_name ?? "Unknown candidate"}
                    </Link>
                    <div className="text-xs text-muted-foreground">{candidate?.email}</div>
                  </td>
                  <td className="py-2">{label?.positionTitle ?? "—"}</td>
                  <td className="py-2">
                    {offer.salary_currency} {offer.salary_amount}
                  </td>
                  <td className="py-2">{new Date(offer.joining_date).toLocaleDateString()}</td>
                  <td className="py-2">
                    <StatusBadge status={offer.status} />
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
