import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listCampuses } from "@/api/campuses";
import { ApiError } from "@/api/client";
import { listDepartments } from "@/api/departments";
import type {
  StaffRoleCategory,
  UserRole,
  VacancyPriority,
  VacancyRequestRead,
  VacancyRequestStatus,
} from "@/api/types";
import {
  deanApproveVacancyRequest,
  hrApproveVacancyRequest,
  listVacancyRequests,
  publishVacancyRequest,
  rejectVacancyRequest,
} from "@/api/vacancyRequests";
import { useAuth } from "@/auth/AuthContext";
import { StatTile } from "@/components/dashboard/StatTile";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const CATEGORY_LABELS: Record<StaffRoleCategory, string> = {
  TEACHING: "Teaching",
  NON_TEACHING: "Non-Teaching",
  HOUSEKEEPING: "Housekeeping",
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
  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: listDepartments });
  // Design-system-foundation step 5: this page's first real toast.tsx
  // consumer (that primitive shipped in step 2 with nothing wired to it
  // yet) -- replaces the old inline `actionError` paragraph entirely, and
  // adds success feedback on all 4 actions that previously had none at all
  // (only a failure ever surfaced anything on this page before).
  const { success, error } = useToast();

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<StaffRoleCategory | "ALL">("ALL");
  const [departmentFilter, setDepartmentFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<VacancyRequestStatus | "ALL">("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Bug fix: unioned with statuses unlocked by an individually-granted
  // REJECT_VACANCY/PUBLISH_VACANCY permission -- vacancy_requests.py's
  // reject/publish endpoints are gated by require_permission, not this role
  // table alone, so a role outside ACTIONABLE_STATUSES_BY_ROLE (e.g. a
  // RECRUITMENT_OFFICER individually granted REJECT_VACANCY) must still see
  // the matching queue rows to act on, same pattern as UsersListPage's
  // canManage. REJECT_VACANCY covers SUBMITTED/DEAN_APPROVED (matches
  // canReject below); PUBLISH_VACANCY covers APPROVED (matches canPublish).
  //
  // APPROVE_VACANCY (2026-09-01) unlocks SUBMITTED and SUBMITTED only. That
  // is not an oversight: `6c010d4` deliberately left hr-approve on the
  // coordinator-capability scheme rather than honouring APPROVE_VACANCY,
  // because the Dean holds APPROVE_VACANCY by default and honouring it at
  // both stages would let a Dean carry a request through HR's stage too.
  const roleStatuses = (user && ACTIONABLE_STATUSES_BY_ROLE[user.role as UserRole]) ?? [];
  const permissionStatuses: VacancyRequestStatus[] = [
    ...(hasPermission?.("APPROVE_VACANCY") ? (["SUBMITTED"] as VacancyRequestStatus[]) : []),
    ...(hasPermission?.("REJECT_VACANCY") ? (["SUBMITTED", "DEAN_APPROVED"] as VacancyRequestStatus[]) : []),
    ...(hasPermission?.("PUBLISH_VACANCY") ? (["APPROVED"] as VacancyRequestStatus[]) : []),
  ];
  const statuses = Array.from(new Set([...roleStatuses, ...permissionStatuses]));
  const takesPartInChain = statuses.length > 0;

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
  // APPROVED and REJECTED are fetched for anyone in the chain, not just the
  // roles that can act on them, because they back the "Approved"/"Rejected"
  // summary tiles -- a Dean should see what became of the requests they
  // approved. The TABLE below still lists only rows whose status is in
  // `statuses`, so fetching them does not widen what anyone can act on.
  const approvedQuery = useQuery({
    queryKey: ["vacancy-requests", "APPROVED"],
    queryFn: () => listVacancyRequests("APPROVED"),
    enabled: takesPartInChain,
  });
  const rejectedQuery = useQuery({
    queryKey: ["vacancy-requests", "REJECTED"],
    queryFn: () => listVacancyRequests("REJECTED"),
    enabled: takesPartInChain,
  });

  const isLoading =
    (statuses.includes("SUBMITTED") && submittedQuery.isLoading) ||
    (statuses.includes("DEAN_APPROVED") && deanApprovedQuery.isLoading) ||
    (takesPartInChain && (approvedQuery.isLoading || rejectedQuery.isLoading));

  const submitted = submittedQuery.data ?? [];
  const deanApproved = deanApprovedQuery.data ?? [];
  const approved = approvedQuery.data ?? [];
  const rejected = rejectedQuery.data ?? [];

  // Deliberately computed off the UNFILTERED rows, matching
  // VacancyRequestsListPage's convention that the tile strip describes the
  // whole picture and the filters narrow only the table beneath it.
  const kpis = {
    pending: submitted.length + deanApproved.length,
    approved: approved.length,
    rejected: rejected.length,
    total: submitted.length + deanApproved.length + approved.length + rejected.length,
  };

  const queue = [
    ...(statuses.includes("SUBMITTED") ? submitted : []),
    ...(statuses.includes("DEAN_APPROVED") ? deanApproved : []),
    ...(statuses.includes("APPROVED") ? approved : []),
  ];

  const hasAnyFilter =
    campusFilter !== "ALL" ||
    categoryFilter !== "ALL" ||
    departmentFilter !== "ALL" ||
    statusFilter !== "ALL" ||
    dateFrom !== "" ||
    dateTo !== "";

  function clearFilters() {
    setCampusFilter("ALL");
    setCategoryFilter("ALL");
    setDepartmentFilter("ALL");
    setStatusFilter("ALL");
    setDateFrom("");
    setDateTo("");
  }

  function matchesFilters(vr: VacancyRequestRead): boolean {
    if (campusFilter !== "ALL" && vr.campus_id !== campusFilter) return false;
    if (categoryFilter !== "ALL" && vr.role_category !== categoryFilter) return false;
    if (departmentFilter !== "ALL" && vr.department_id !== departmentFilter) return false;
    if (statusFilter !== "ALL" && vr.status !== statusFilter) return false;
    // The Date filter reads `created_at` -- when the request was raised --
    // rather than `waitingSince`, which moves every time the request changes
    // stage and so would make a saved range mean something different tomorrow.
    // Compared as yyyy-mm-dd strings so an inclusive `to` needs no end-of-day
    // arithmetic and no timezone conversion of the user's typed date.
    const raisedOn = vr.created_at.slice(0, 10);
    if (dateFrom && raisedOn < dateFrom) return false;
    if (dateTo && raisedOn > dateTo) return false;
    return true;
  }

  const filteredQueue = queue.filter(matchesFilters);
  const sortedQueue = [...filteredQueue].sort((a, b) => {
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

      {takesPartInChain ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Pending" value={kpis.pending} isLoading={isLoading} accent="gold" />
          <StatTile label="Approved" value={kpis.approved} isLoading={isLoading} accent="green" />
          <StatTile label="Rejected" value={kpis.rejected} isLoading={isLoading} accent="red" />
          <StatTile label="Total" value={kpis.total} isLoading={isLoading} accent="blue" />
        </div>
      ) : null}

      {takesPartInChain ? (
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-40">
              <Select value={campusFilter} onValueChange={setCampusFilter}>
                <SelectTrigger aria-label="Campus filter">
                  <SelectValue className="truncate" />
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
            <div className="w-44">
              <Select
                value={categoryFilter}
                onValueChange={(v) => setCategoryFilter(v as StaffRoleCategory | "ALL")}
              >
                <SelectTrigger aria-label="Category filter">
                  <SelectValue className="truncate" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All categories</SelectItem>
                  {(Object.keys(CATEGORY_LABELS) as StaffRoleCategory[]).map((category) => (
                    <SelectItem key={category} value={category}>
                      {CATEGORY_LABELS[category]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-48">
              <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                <SelectTrigger aria-label="Department filter">
                  <SelectValue className="truncate" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All departments</SelectItem>
                  {departments?.map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-44">
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as VacancyRequestStatus | "ALL")}
              >
                <SelectTrigger aria-label="Status filter">
                  <SelectValue className="truncate" />
                </SelectTrigger>
                <SelectContent>
                  {/* Only the statuses this user's queue can actually contain
                      -- offering REJECTED here would always filter to nothing,
                      since the table lists `statuses` rows only. */}
                  <SelectItem value="ALL">All statuses</SelectItem>
                  {statuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="approvals_date_from" className="text-xs text-muted-foreground">
                Raised
              </Label>
              <Input
                id="approvals_date_from"
                type="date"
                aria-label="Raised from"
                className="w-40"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                id="approvals_date_to"
                type="date"
                aria-label="Raised to"
                className="w-40"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <Button variant="outline" size="sm" disabled={!hasAnyFilter} onClick={clearFilters} className="gap-1.5">
              <X className="h-3.5 w-3.5" />
              Clear filters
            </Button>
          </div>
        </Card>
      ) : null}

      {/* UI redesign Phase 3 -- one Card boundary shared by every branch
          (no-role / loading / empty / table), not just the loaded table. */}
      <Card>
        <CardContent className="p-0">
          {!takesPartInChain ? (
            <p className="p-6 text-sm text-muted-foreground">Your role doesn't take part in the approval chain.</p>
          ) : isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : sortedQueue.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {queue.length === 0 ? "No pending vacancy approvals" : "No vacancy approvals match these filters."}
            </p>
          ) : (
            // Design-system-foundation step 5: migrated off a hand-rolled
            // <table> onto the shared Table primitive (components/ui/table.tsx),
            // same swap VacancyRequestsListPage/DepartmentVacancyDetailTable
            // made in this same step and SanctionedStrengthPage made in step 4.
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Campus</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Raised by</TableHead>
                  <TableHead>Waiting</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedQueue.map((vr) => {
                  const campus = campuses?.find((c) => c.id === vr.campus_id);
                  const department = departments?.find((d) => d.id === vr.department_id);
                  // Bug fix: OR'd with hasPermission(...) -- see the
                  // `statuses` computation above for the full explanation.
                  const canDeanApprove =
                    (role === "ASSOCIATE_DEAN_RECRUITMENT" ||
                      role === "SUPER_ADMIN" ||
                      (hasPermission?.("APPROVE_VACANCY") ?? false)) &&
                    vr.status === "SUBMITTED";
                  const canHrApprove =
                    (role === "HR_ADMIN" || role === "SUPER_ADMIN" || role === "RECRUITMENT_COORDINATOR") &&
                    (vr.status === "DEAN_APPROVED" || (vr.status === "SUBMITTED" && role === "SUPER_ADMIN"));
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
                      <TableCell className="font-mono text-xs">{vr.request_ref ?? "—"}</TableCell>
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
                      <TableCell>{department?.name ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{CATEGORY_LABELS[vr.role_category]}</TableCell>
                      <TableCell>{vr.priority}</TableCell>
                      {/* Server-computed: prefers `requester_name` on a QR row,
                          where `requested_by_id` is the intake account rather
                          than the person who asked. */}
                      <TableCell>{vr.requested_by_name ?? "—"}</TableCell>
                      <TableCell>{formatWaiting(waitingSince(vr))}</TableCell>
                      <TableCell>
                        <StatusBadge status={vr.status} />
                      </TableCell>
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
