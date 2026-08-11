import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listCampuses } from "@/api/campuses";
import { ApiError } from "@/api/client";
import type { UserRole, VacancyPriority, VacancyRequestRead, VacancyRequestStatus } from "@/api/types";
import {
  deanApproveVacancyRequest,
  hrApproveVacancyRequest,
  listVacancyRequests,
  publishVacancyRequest,
  rejectVacancyRequest,
} from "@/api/vacancyRequests";
import { useAuth } from "@/auth/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/vacancy-requests/StatusBadge";

// Mirrors the backend's own approval-chain role groupings
// (app/models/enums.py::VACANCY_APPROVAL_DEAN_ROLES / VACANCY_APPROVAL_HR_ROLES):
// which statuses actually need *this* role's action next.
const ACTIONABLE_STATUSES_BY_ROLE: Record<string, VacancyRequestStatus[]> = {
  ASSOCIATE_DEAN_RECRUITMENT: ["SUBMITTED"],
  HR_ADMIN: ["DEAN_APPROVED", "APPROVED"],
  SUPER_ADMIN: ["SUBMITTED", "DEAN_APPROVED", "APPROVED"],
  RECRUITMENT_COORDINATOR: ["DEAN_APPROVED", "APPROVED"],
};

const STATUS_ACTION_LABEL: Record<VacancyRequestStatus, string> = {
  DRAFT: "",
  SUBMITTED: "Needs dean approval",
  DEAN_APPROVED: "Needs HR approval",
  APPROVED: "Ready to publish",
  PUBLISHED: "",
  CLOSED: "",
  REJECTED: "",
  CANCELLED: "",
};

// Higher-priority requests should surface first; ties break on how long the
// request has been sitting in *this* queue stage (oldest first).
const PRIORITY_RANK: Record<VacancyPriority, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

function waitingSince(vr: VacancyRequestRead): string {
  if (vr.status === "SUBMITTED") return vr.submitted_at ?? vr.created_at;
  if (vr.status === "DEAN_APPROVED") return vr.dean_reviewed_at ?? vr.created_at;
  if (vr.status === "APPROVED") return vr.hr_reviewed_at ?? vr.created_at;
  return vr.created_at;
}

function formatWaiting(iso: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export function VacancyApprovalsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const queryClient = useQueryClient();
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });

  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

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
  const sortedQueue = [...queue].sort((a, b) => {
    const rankDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (rankDiff !== 0) return rankDiff;
    return new Date(waitingSince(a)).getTime() - new Date(waitingSince(b)).getTime();
  });

  function afterAction() {
    setActionError(null);
    void queryClient.invalidateQueries({ queryKey: ["vacancy-requests"] });
  }

  function onActionError(err: unknown) {
    setActionError(err instanceof ApiError ? err.message : "Action failed");
  }

  const deanApproveMutation = useMutation({
    mutationFn: (id: string) => deanApproveVacancyRequest(id),
    onSuccess: afterAction,
    onError: onActionError,
  });
  const hrApproveMutation = useMutation({
    mutationFn: (id: string) => hrApproveVacancyRequest(id),
    onSuccess: afterAction,
    onError: onActionError,
  });
  const publishMutation = useMutation({
    mutationFn: (id: string) => publishVacancyRequest(id),
    onSuccess: afterAction,
    onError: onActionError,
  });
  const rejectMutation = useMutation({
    mutationFn: () => rejectVacancyRequest(rejectingId!, rejectReason),
    onSuccess: () => {
      afterAction();
      setRejectingId(null);
      setRejectReason("");
    },
    onError: onActionError,
  });

  const isBusy =
    deanApproveMutation.isPending ||
    hrApproveMutation.isPending ||
    publishMutation.isPending ||
    rejectMutation.isPending;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Vacancy Approvals</h1>
        <p className="text-sm text-muted-foreground">Vacancy requests waiting on your approval.</p>
      </div>

      {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}

      {statuses.length === 0 ? (
        <p className="text-sm text-muted-foreground">Your role doesn't take part in the approval chain.</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : sortedQueue.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing is waiting on your approval right now.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 font-medium">Position</th>
              <th className="py-2 font-medium">Campus</th>
              <th className="py-2 font-medium">Priority</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Next action</th>
              <th className="py-2 font-medium">Waiting</th>
              <th className="py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedQueue.map((vr) => {
              const campus = campuses?.find((c) => c.id === vr.campus_id);
              const canDeanApprove = (role === "ASSOCIATE_DEAN_RECRUITMENT" || role === "SUPER_ADMIN") && vr.status === "SUBMITTED";
              const canHrApprove =
                (role === "HR_ADMIN" || role === "SUPER_ADMIN" || role === "RECRUITMENT_COORDINATOR") &&
                (vr.status === "DEAN_APPROVED" || (vr.status === "SUBMITTED" && role === "SUPER_ADMIN"));
              const canPublish =
                (role === "HR_ADMIN" || role === "SUPER_ADMIN" || role === "RECRUITMENT_COORDINATOR") &&
                vr.status === "APPROVED";
              const canReject =
                (role === "ASSOCIATE_DEAN_RECRUITMENT" ||
                  role === "HR_ADMIN" ||
                  role === "SUPER_ADMIN" ||
                  role === "RECRUITMENT_COORDINATOR") &&
                (vr.status === "SUBMITTED" || vr.status === "DEAN_APPROVED");
              return (
                <tr key={vr.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <Link to={`/vacancy-requests/${vr.id}`} className="font-medium hover:underline">
                        {vr.position_title}
                      </Link>
                      {/* Phase E badge -- reuses the existing `destructive`
                          variant, mirrors VacancyRequestDetailPage's. */}
                      {vr.is_over_sanction ? <Badge variant="destructive">Over-sanction</Badge> : null}
                    </div>
                  </td>
                  <td className="py-2 font-mono text-xs">{campus?.code ?? "—"}</td>
                  <td className="py-2">{vr.priority}</td>
                  <td className="py-2">
                    <StatusBadge status={vr.status} />
                  </td>
                  <td className="py-2 text-muted-foreground">{STATUS_ACTION_LABEL[vr.status]}</td>
                  <td className="py-2">{formatWaiting(waitingSince(vr))}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-2">
                      {canDeanApprove ? (
                        <Button size="sm" disabled={isBusy} onClick={() => deanApproveMutation.mutate(vr.id)}>
                          Dean-approve
                        </Button>
                      ) : null}
                      {canHrApprove ? (
                        <Button size="sm" disabled={isBusy} onClick={() => hrApproveMutation.mutate(vr.id)}>
                          HR-approve
                        </Button>
                      ) : null}
                      {canPublish ? (
                        <Button size="sm" disabled={isBusy} onClick={() => publishMutation.mutate(vr.id)}>
                          Publish
                        </Button>
                      ) : null}
                      {canReject ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={isBusy}
                          onClick={() => {
                            setRejectingId(vr.id);
                            setRejectReason("");
                          }}
                        >
                          Reject
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Dialog open={rejectingId !== null} onOpenChange={(open) => !open && setRejectingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject vacancy request</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="approvals_reject_reason">Reason</Label>
            <Textarea
              id="approvals_reject_reason"
              required
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || rejectMutation.isPending}
              onClick={() => rejectMutation.mutate()}
            >
              {rejectMutation.isPending ? "Rejecting…" : "Confirm reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
