import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listApplications } from "@/api/applications";
import { listCampuses } from "@/api/campuses";
import { listCandidates } from "@/api/candidates";
import { listOffers } from "@/api/offers";
import type { OfferStatus } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge } from "@/components/offers/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

const CAN_VIEW_ROLES = ["HR_ADMIN", "SUPER_ADMIN", "MANAGEMENT"];
const CAN_CREATE_ROLES = ["HR_ADMIN", "SUPER_ADMIN"];
const STATUSES: OfferStatus[] = ["DRAFT", "SENT", "ACCEPTED", "DECLINED", "EXPIRED", "WITHDRAWN"];

export function OffersListPage() {
  const { user } = useAuth();
  const canView = Boolean(user && CAN_VIEW_ROLES.includes(user.role));

  const [statusFilter, setStatusFilter] = useState<OfferStatus | "ALL">("ALL");
  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");

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
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses, enabled: canView });
  const { getLabel } = useJobPostingLookup();

  const normalizedSearch = search.trim().toLowerCase();
  const filteredOffers = offers?.filter((offer) => {
    const application = applications?.find((a) => a.id === offer.application_id);
    if (statusFilter !== "ALL" && offer.status !== statusFilter) return false;
    if (campusFilter !== "ALL" && application?.campus_id !== campusFilter) return false;
    if (!normalizedSearch) return true;
    const candidate = application ? candidates?.find((c) => c.id === application.candidate_id) : undefined;
    const label = application ? getLabel(application.job_posting_id) : undefined;
    return (
      (candidate?.full_name.toLowerCase().includes(normalizedSearch) ?? false) ||
      (label?.positionTitle.toLowerCase().includes(normalizedSearch) ?? false)
    );
  });

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

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-72">
          <Input
            placeholder="Search by candidate or position"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-56">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as OfferStatus | "ALL")}>
            <SelectTrigger aria-label="Status filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
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

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !filteredOffers || filteredOffers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {offers && offers.length > 0 ? "No offers match these filters." : "No offers yet."}
        </p>
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
            {filteredOffers.map((offer) => {
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
