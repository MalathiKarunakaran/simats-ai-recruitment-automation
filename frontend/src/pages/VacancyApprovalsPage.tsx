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
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
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
  const { user, hasPermission } = useAuth();
  const role = user?.role;
  const queryClient = useQueryClient();
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });
  // Design-system-foundation step 5: this page's first real toast.tsx
  // consumer (that primitive shipped in step 2 with nothing wired to it
  // yet) -- replaces the old inline `actionError` paragraph entirely, and
  // adds success feedback on all 4 actions that previously had none at all
  // (only a failure ever surfaced anything on this page before).
  const { success, error } = useToast();

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // Bug fix: unioned with statuses unlocked by an individually-granted
  // REJECT_VACANCY/PUBLISH_VACANCY permission -- vacancy_requests.py's
  // reject/publish endpoints are gated by require_permission, not this role
  // table alone, so a role outside ACTIONABLE_STATUSES_BY_ROLE (e.g. a
  // RECRUITMENT_OFFICER individually granted REJECT_VACANCY) must still see
  // the matching queue rows to act on, same pattern as UsersListPage's
  // canManage. REJECT_VACANCY covers SUBMITTED/DEAN_APPROVED (matches
  // canReject below); PUBLISH_VACANCY covers APPROVED (matches canPublish).
  const roleStatuses = (user && ACTIONABLE_STATUSES_BY_ROLE[user.role as UserRole]) ?? [];
  const permissionStatuses: VacancyRequestStatus[] = [
    ...(hasPermission?.("REJECT_VACANCY") ? (["SUBMITTED", "DEAN_APPROVED"] as VacancyRequestStatus[]) : []),
    ...(hasPermission?.("PUBLISH_VACANCY") ? (["APPROVED"] as VacancyRequestStatus[]) : []),
  ];
  const statuses = Array.from(new Set([...roleStatuses, ...permissionStatuses]));

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
    void queryClient.invalidateQueries({ queryKey: ["vacancy-requests"] });
  }

  function onActionError(err: unknown) {
    error(err instanceof ApiError ? err.message : "Action failed");
  }

  const deanApproveMutation = useMutation({
    mutationFn: (id: string) => deanApproveVacancyRequest(id),
    onSuccess: () => {
      afterAction();
      success("Vacancy request dean-approved.");
    },
    onError: onActionError,
  });
  const hrApproveMutation = useMutation({
    mutationFn: (id: string) => hrApproveVacancyRequest(id),
    onSuccess: () => {
      afterAction();
      success("Vacancy request HR-approved.");
    },
    onError: onActionError,
  });
  const publishMutation = useMutation({
    mutationFn: (id: string) => publishVacancyRequest(id),
    onSuccess: () => {
      afterAction();
      success("Vacancy request published.");
    },
    onError: onActionError,
  });
  const rejectMutation = useMutation({
    mutationFn: () => rejectVacancyRequest(rejectingId!, rejectReason),
    onSuccess: () => {
      afterAction();
      success("Vacancy request rejected.");
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

      {/* UI redesign Phase 3 -- one Card boundary shared by every branch
          (no-role / loading / empty / table), not just the loaded table. */}
      <Card>
        <CardContent className="p-0">
          {statuses.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Your role doesn't take part in the approval chain.</p>
          ) : isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : sortedQueue.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Nothing is waiting on your approval right now.</p>
          ) : (
            // Design-system-foundation step 5: migrated off a hand-rolled
            // <table> onto the shared Table primitive (components/ui/table.tsx),
            // same swap VacancyRequestsListPage/DepartmentVacancyDetailTable
            // made in this same step and SanctionedStrengthPage made in step 4.
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Position</TableHead>
                  <TableHead>Campus</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Next action</TableHead>
                  <TableHead>Waiting</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedQueue.map((vr) => {
                  const campus = campuses?.find((c) => c.id === vr.campus_id);
                  const canDeanApprove =
                    (role === "ASSOCIATE_DEAN_RECRUITMENT" || role === "SUPER_ADMIN") && vr.status === "SUBMITTED";
                  const canHrApprove =
                    (role === "HR_ADMIN" || role === "SUPER_ADMIN" || role === "RECRUITMENT_COORDINATOR") &&
                    (vr.status === "DEAN_APPROVED" || (vr.status === "SUBMITTED" && role === "SUPER_ADMIN"));
                  // Bug fix: OR'd with hasPermission(...) -- see the
                  // `statuses` computation above for the full explanation.
                  const canPublish =
                    ((role === "HR_ADMIN" || role === "SUPER_ADMIN" || role === "RECRUITMENT_COORDINATOR") ||
                      (hasPermission?.("PUBLISH_VACANCY") ?? false)) &&
                    vr.status === "APPROVED";
                  const canReject =
                    ((role === "ASSOCIATE_DEAN_RECRUITMENT" ||
                      role === "HR_ADMIN" ||
                      role === "SUPER_ADMIN" ||
                      role === "RECRUITMENT_COORDINATOR") ||
                      (hasPermission?.("REJECT_VACANCY") ?? false)) &&
                    (vr.status === "SUBMITTED" || vr.status === "DEAN_APPROVED");
                  return (
                    <TableRow key={vr.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Link to={`/vacancy-requests/${vr.id}`} className="font-medium hover:underline">
                            {vr.position_title}
                          </Link>
                          {/* Phase E badge -- reuses the existing `destructive`
                              variant, mirrors VacancyRequestDetailPage's. */}
                          {vr.is_over_sanction ? <Badge variant="destructive">Over-sanction</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{campus?.code ?? "—"}</TableCell>
                      <TableCell>{vr.priority}</TableCell>
                      <TableCell>
                        <StatusBadge status={vr.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{STATUS_ACTION_LABEL[vr.status]}</TableCell>
                      <TableCell>{formatWaiting(waitingSince(vr))}</TableCell>
                      <TableCell>
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
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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
