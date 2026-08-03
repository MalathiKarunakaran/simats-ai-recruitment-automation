import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";

import { getApprovedVacancyForRequest, listHiringSlots } from "@/api/approvedVacancies";
import { ApiError } from "@/api/client";
import {
  cancelVacancyRequest,
  closeVacancyRequest,
  deanApproveVacancyRequest,
  deleteVacancyRequest,
  generateJd,
  getVacancyRequest,
  hrApproveVacancyRequest,
  publishVacancyRequest,
  rejectVacancyRequest,
  submitVacancyRequest,
  updateSlotCount,
} from "@/api/vacancyRequests";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/vacancy-requests/StatusBadge";

export function VacancyRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [jdDialogOpen, setJdDialogOpen] = useState(false);
  const [jdInstructions, setJdInstructions] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [slotCountDialogOpen, setSlotCountDialogOpen] = useState(false);
  const [slotCountInput, setSlotCountInput] = useState("");

  const { data: vr, isLoading } = useQuery({
    queryKey: ["vacancy-request", id],
    queryFn: () => getVacancyRequest(id!),
    enabled: Boolean(id),
  });

  const canViewPositions = vr?.status === "APPROVED" || vr?.status === "PUBLISHED";

  const { data: approvedVacancy } = useQuery({
    queryKey: ["approved-vacancy", id],
    queryFn: () => getApprovedVacancyForRequest(id!),
    enabled: Boolean(id) && canViewPositions,
  });

  const { data: hiringSlots } = useQuery({
    queryKey: ["hiring-slots", approvedVacancy?.id],
    queryFn: () => listHiringSlots(approvedVacancy!.id),
    enabled: Boolean(approvedVacancy),
  });

  function afterAction() {
    void queryClient.invalidateQueries({ queryKey: ["vacancy-request", id] });
    void queryClient.invalidateQueries({ queryKey: ["vacancy-requests"] });
  }

  function makeMutation<T>(fn: (id: string) => Promise<T>) {
    return {
      mutationFn: () => fn(id!),
      onSuccess: () => {
        setError(null);
        afterAction();
      },
      onError: (err: unknown) => setError(err instanceof ApiError ? err.message : "Action failed"),
    };
  }

  const submitMutation = useMutation(makeMutation(submitVacancyRequest));
  const deanApproveMutation = useMutation(makeMutation(deanApproveVacancyRequest));
  const hrApproveMutation = useMutation(makeMutation(hrApproveVacancyRequest));
  const publishMutation = useMutation(makeMutation(publishVacancyRequest));
  const closeMutation = useMutation(makeMutation(closeVacancyRequest));
  const deleteMutation = useMutation({
    mutationFn: () => deleteVacancyRequest(id!),
    onSuccess: () => navigate("/vacancy-requests"),
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : "Delete failed"),
  });
  const rejectMutation = useMutation({
    mutationFn: () => rejectVacancyRequest(id!, rejectReason),
    onSuccess: () => {
      setError(null);
      setRejectDialogOpen(false);
      setRejectReason("");
      afterAction();
    },
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : "Reject failed"),
  });
  const generateJdMutation = useMutation({
    mutationFn: () => generateJd(id!, { additional_instructions: jdInstructions || null }),
    onSuccess: () => {
      setError(null);
      setJdDialogOpen(false);
      setJdInstructions("");
      afterAction();
    },
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : "JD generation failed"),
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelVacancyRequest(id!, cancelReason),
    onSuccess: () => {
      setError(null);
      setCancelDialogOpen(false);
      setCancelReason("");
      afterAction();
    },
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : "Cancel failed"),
  });
  const updateSlotCountMutation = useMutation({
    mutationFn: () => updateSlotCount(id!, Number(slotCountInput)),
    onSuccess: () => {
      setError(null);
      setSlotCountDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["approved-vacancy", id] });
      void queryClient.invalidateQueries({ queryKey: ["hiring-slots", approvedVacancy?.id] });
      afterAction();
    },
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : "Adjust count failed"),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!vr || !user) {
    return <Navigate to="/vacancy-requests" replace />;
  }

  const role = user.role;
  const canSubmit = (role === "CAMPUS_HOD" || role === "SUPER_ADMIN") && vr.status === "DRAFT";
  const canEdit = canSubmit;
  const canDelete = canSubmit;
  const canDeanApprove = (role === "ASSOCIATE_DEAN_RECRUITMENT" || role === "SUPER_ADMIN") && vr.status === "SUBMITTED";
  const canReject =
    (role === "ASSOCIATE_DEAN_RECRUITMENT" ||
      role === "HR_ADMIN" ||
      role === "SUPER_ADMIN" ||
      role === "RECRUITMENT_COORDINATOR") &&
    (vr.status === "SUBMITTED" || vr.status === "DEAN_APPROVED");
  const canHrApprove =
    (role === "HR_ADMIN" || role === "SUPER_ADMIN" || role === "RECRUITMENT_COORDINATOR") &&
    (vr.status === "DEAN_APPROVED" || (vr.status === "SUBMITTED" && role === "SUPER_ADMIN"));
  const canPublish =
    (role === "HR_ADMIN" || role === "RECRUITMENT_OFFICER" || role === "SUPER_ADMIN" || role === "RECRUITMENT_COORDINATOR") &&
    vr.status === "APPROVED";
  const canClose =
    (role === "HR_ADMIN" || role === "SUPER_ADMIN" || role === "RECRUITMENT_COORDINATOR") && vr.status === "PUBLISHED";
  const canCancel =
    (role === "HR_ADMIN" || role === "SUPER_ADMIN" || role === "RECRUITMENT_COORDINATOR") &&
    ["SUBMITTED", "DEAN_APPROVED", "APPROVED", "PUBLISHED"].includes(vr.status);
  const canAdjustSlotCount =
    (role === "HR_ADMIN" || role === "SUPER_ADMIN" || role === "RECRUITMENT_COORDINATOR") &&
    (vr.status === "APPROVED" || vr.status === "PUBLISHED");

  const canGenerateJd = canSubmit;

  const isBusy =
    submitMutation.isPending ||
    deanApproveMutation.isPending ||
    hrApproveMutation.isPending ||
    publishMutation.isPending ||
    closeMutation.isPending ||
    deleteMutation.isPending ||
    rejectMutation.isPending ||
    generateJdMutation.isPending ||
    cancelMutation.isPending ||
    updateSlotCountMutation.isPending;

  const openSlotCount = hiringSlots?.filter((s) => s.status === "OPEN").length ?? 0;
  const reservedSlotCount = hiringSlots?.filter((s) => s.status === "RESERVED").length ?? 0;
  const filledSlotCount = hiringSlots?.filter((s) => s.status === "FILLED").length ?? 0;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{vr.position_title}</h1>
          <div className="mt-1">
            <StatusBadge status={vr.status} />
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/vacancy-requests">Back to list</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Role category</div>
            <div>{vr.role_category.replace(/_/g, " ")}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Employment type</div>
            <div>{vr.employment_type.replace(/_/g, " ")}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Requested count</div>
            <div>{vr.requested_count}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Priority</div>
            <div>{vr.priority}</div>
          </div>
          <div className="col-span-2">
            <div className="text-muted-foreground">Qualification</div>
            <div>{vr.qualification}</div>
          </div>
          <div className="col-span-2">
            <div className="text-muted-foreground">Experience required</div>
            <div>{vr.experience_required}</div>
          </div>
          {vr.salary_band_min || vr.salary_band_max ? (
            <div>
              <div className="text-muted-foreground">Salary band</div>
              <div>
                {vr.salary_band_min ?? "—"} – {vr.salary_band_max ?? "—"}
              </div>
            </div>
          ) : null}
          {vr.skills?.length ? (
            <div className="col-span-2">
              <div className="text-muted-foreground">Skills</div>
              <div>{vr.skills.join(", ")}</div>
            </div>
          ) : null}
          {vr.status === "REJECTED" && vr.rejection_reason ? (
            <div className="col-span-2">
              <div className="text-muted-foreground">Rejection reason</div>
              <div>{vr.rejection_reason}</div>
            </div>
          ) : null}
          {vr.status === "CANCELLED" && vr.cancellation_reason ? (
            <div className="col-span-2">
              <div className="text-muted-foreground">Cancellation reason</div>
              <div>{vr.cancellation_reason}</div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {canViewPositions && approvedVacancy ? (
        <Card>
          <CardHeader>
            <CardTitle>Positions</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Total positions</div>
              <div>{approvedVacancy.total_positions}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Open / Reserved / Filled</div>
              <div>
                {openSlotCount} / {reservedSlotCount} / {filledSlotCount}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Job Description</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {vr.jd_draft ? (
            <pre className="whitespace-pre-wrap font-sans">{vr.jd_draft}</pre>
          ) : (
            <p className="text-muted-foreground">No job description generated yet.</p>
          )}
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        {canEdit ? (
          <Button variant="outline" asChild>
            <Link to={`/vacancy-requests/${vr.id}/edit`}>Edit</Link>
          </Button>
        ) : null}
        {canSubmit ? (
          <Button disabled={isBusy} onClick={() => submitMutation.mutate()}>
            Submit
          </Button>
        ) : null}
        {canGenerateJd ? (
          <Dialog open={jdDialogOpen} onOpenChange={setJdDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" disabled={isBusy}>
                {vr.jd_draft ? "Regenerate JD" : "Generate JD"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Generate job description</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="jd_instructions">Additional instructions (optional)</Label>
                <Textarea
                  id="jd_instructions"
                  value={jdInstructions}
                  onChange={(e) => setJdInstructions(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button disabled={generateJdMutation.isPending} onClick={() => generateJdMutation.mutate()}>
                  {generateJdMutation.isPending ? "Generating…" : "Generate"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
        {canDeanApprove ? (
          <Button disabled={isBusy} onClick={() => deanApproveMutation.mutate()}>
            Dean-approve
          </Button>
        ) : null}
        {canHrApprove ? (
          <Button disabled={isBusy} onClick={() => hrApproveMutation.mutate()}>
            HR-approve
          </Button>
        ) : null}
        {canPublish ? (
          <Button disabled={isBusy} onClick={() => publishMutation.mutate()}>
            Publish
          </Button>
        ) : null}
        {canClose ? (
          <Button variant="outline" disabled={isBusy} onClick={() => closeMutation.mutate()}>
            Close
          </Button>
        ) : null}
        {canAdjustSlotCount ? (
          <Dialog
            open={slotCountDialogOpen}
            onOpenChange={(open) => {
              setSlotCountDialogOpen(open);
              if (open) setSlotCountInput(String(approvedVacancy?.total_positions ?? ""));
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" disabled={isBusy}>
                Adjust count
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Adjust position count</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="slot_count">Requested count</Label>
                <Input
                  id="slot_count"
                  type="number"
                  min={1}
                  value={slotCountInput}
                  onChange={(e) => setSlotCountInput(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button
                  disabled={!slotCountInput || Number(slotCountInput) < 1 || updateSlotCountMutation.isPending}
                  onClick={() => updateSlotCountMutation.mutate()}
                >
                  {updateSlotCountMutation.isPending ? "Updating…" : "Update count"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
        {canCancel ? (
          <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" disabled={isBusy}>
                Cancel
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Cancel vacancy request</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cancel_reason">Reason</Label>
                <Textarea
                  id="cancel_reason"
                  required
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button
                  variant="destructive"
                  disabled={!cancelReason.trim() || cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate()}
                >
                  {cancelMutation.isPending ? "Cancelling…" : "Confirm cancel"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
        {canReject ? (
          <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" disabled={isBusy}>
                Reject
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reject vacancy request</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reject_reason">Reason</Label>
                <Textarea
                  id="reject_reason"
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
        ) : null}
        {canDelete ? (
          <Button variant="destructive" disabled={isBusy} onClick={() => deleteMutation.mutate()}>
            Delete
          </Button>
        ) : null}
      </div>
    </div>
  );
}
