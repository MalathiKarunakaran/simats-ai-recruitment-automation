import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { getCandidate, updateCandidate, withdrawCandidate } from "@/api/candidates";
import { listApplications } from "@/api/applications";
import { ApiError } from "@/api/client";
import type { CandidateSource } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge as ApplicationStatusBadge } from "@/components/applications/StatusBadge";
import { StatusBadge as CandidateStatusBadge } from "@/components/candidates/StatusBadge";
import { ResumeUpload } from "@/components/candidates/ResumeUpload";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { combine, email as emailValidator, required, useFieldValidation } from "@/hooks/useFieldValidation";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";
import { CAN_MANAGE_CANDIDATES_ROLES } from "@/pages/CandidatesListPage";

// Mirrors the 4 real sourcing channels (app/schemas/candidate.py::CandidateSource),
// same list CandidateCreatePage uses.
const SOURCE_OPTIONS: CandidateSource[] = ["Reference", "Job Portal", "FacultyPlus", "Walk-in"];

export function CandidateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [error, setError] = useState<string | null>(null);
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const reason = useFieldValidation("", required());

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const editFullName = useFieldValidation("", required("Full name is required"));
  const editEmail = useFieldValidation("", combine(required("Email is required"), emailValidator()));
  const [editPhoneNumber, setEditPhoneNumber] = useState("");
  const [editSource, setEditSource] = useState<CandidateSource | "">("");
  const [editReferenceName, setEditReferenceName] = useState("");
  const [editReferenceNameError, setEditReferenceNameError] = useState<string | null>(null);

  const { data: candidate, isLoading } = useQuery({
    queryKey: ["candidate", id],
    queryFn: () => getCandidate(id!),
    enabled: Boolean(id),
  });

  const { data: applications } = useQuery({
    queryKey: ["applications", { candidateId: id }],
    queryFn: () => listApplications({ candidateId: id }),
    enabled: Boolean(id),
  });

  const { getLabel } = useJobPostingLookup();

  const withdrawMutation = useMutation({
    mutationFn: () => withdrawCandidate(id!, { reason: reason.value }),
    onSuccess: () => {
      setError(null);
      setWithdrawDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["candidate", id] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Withdraw failed"),
  });

  const editMutation = useMutation({
    mutationFn: () =>
      updateCandidate(id!, {
        full_name: editFullName.value,
        email: editEmail.value,
        phone_number: editPhoneNumber || null,
        source: editSource || null,
        reference_name: editSource === "Reference" ? editReferenceName : null,
      }),
    onSuccess: () => {
      setEditError(null);
      setEditDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["candidate", id] });
    },
    onError: (err) => setEditError(err instanceof ApiError ? err.message : "Update failed"),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!candidate) {
    return <Navigate to="/candidates" replace />;
  }

  const canWithdraw = Boolean(user && CAN_MANAGE_CANDIDATES_ROLES.includes(user.role));
  // Same write-gate as Withdraw/create -- PATCH /candidates/{id} shares
  // _write_gate with create_candidate/withdraw_candidate in
  // app/api/v1/routers/candidates.py.
  const canEdit = canWithdraw;

  function submitWithdraw() {
    if (!reason.validate()) return;
    withdrawMutation.mutate();
  }

  function openEditDialog() {
    // `candidate` is guaranteed defined here (the `if (!candidate)` early
    // return above already ran before this closure can be invoked from the
    // Edit button's onClick), but TS's control-flow narrowing doesn't carry
    // into nested function declarations -- non-null assert explicitly.
    editFullName.onChange(candidate!.full_name);
    editEmail.onChange(candidate!.email);
    setEditPhoneNumber(candidate!.phone_number ?? "");
    setEditSource((candidate!.source as CandidateSource | null) ?? "");
    setEditReferenceName(candidate!.reference_name ?? "");
    setEditReferenceNameError(null);
    setEditError(null);
    setEditDialogOpen(true);
  }

  function submitEdit() {
    const fullNameValid = editFullName.validate();
    const emailValid = editEmail.validate();
    let referenceNameValid = true;
    if (editSource === "Reference" && !editReferenceName.trim()) {
      referenceNameValid = false;
      setEditReferenceNameError("Reference name is required when source is Reference");
    } else {
      setEditReferenceNameError(null);
    }
    if (!fullNameValid || !emailValid || !referenceNameValid) return;
    editMutation.mutate();
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{candidate.full_name}</h1>
          <div className="mt-1">
            <CandidateStatusBadge status={candidate.is_withdrawn} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit ? (
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" onClick={openEditDialog}>
                  Edit
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit candidate</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit_full_name">Full name</Label>
                    <Input
                      id="edit_full_name"
                      required
                      value={editFullName.value}
                      onChange={(e) => editFullName.onChange(e.target.value)}
                      onBlur={editFullName.onBlur}
                      aria-invalid={Boolean(editFullName.error)}
                    />
                    {editFullName.error ? <p className="text-xs text-destructive">{editFullName.error}</p> : null}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit_email">Email</Label>
                    <Input
                      id="edit_email"
                      type="email"
                      required
                      value={editEmail.value}
                      onChange={(e) => editEmail.onChange(e.target.value)}
                      onBlur={editEmail.onBlur}
                      aria-invalid={Boolean(editEmail.error)}
                    />
                    {editEmail.error ? <p className="text-xs text-destructive">{editEmail.error}</p> : null}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit_phone_number">Phone number (optional)</Label>
                    <Input
                      id="edit_phone_number"
                      value={editPhoneNumber}
                      onChange={(e) => setEditPhoneNumber(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Source (optional)</Label>
                    <Select value={editSource} onValueChange={(value) => setEditSource(value as CandidateSource)}>
                      <SelectTrigger>
                        <SelectValue placeholder="How did they hear about this role?" />
                      </SelectTrigger>
                      <SelectContent>
                        {SOURCE_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {editSource === "Reference" ? (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="edit_reference_name">Reference name</Label>
                      <Input
                        id="edit_reference_name"
                        required
                        value={editReferenceName}
                        onChange={(e) => setEditReferenceName(e.target.value)}
                        aria-invalid={Boolean(editReferenceNameError)}
                      />
                      {editReferenceNameError ? (
                        <p className="text-xs text-destructive">{editReferenceNameError}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {editError ? <p className="text-sm text-destructive">{editError}</p> : null}
                <DialogFooter>
                  <Button disabled={editMutation.isPending} onClick={submitEdit}>
                    {editMutation.isPending ? "Saving…" : "Save changes"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}
          <Button variant="outline" size="sm" asChild>
            <Link to="/candidates">Back to list</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Email</div>
            <div>{candidate.email}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Phone</div>
            <div>{candidate.phone_number ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Source</div>
            <div>{candidate.source ?? "—"}</div>
          </div>
          {candidate.source === "Reference" && candidate.reference_name ? (
            <div>
              <div className="text-muted-foreground">Reference name</div>
              <div>{candidate.reference_name}</div>
            </div>
          ) : null}
          <div className="col-span-2">
            <div className="mb-1 text-muted-foreground">Resume</div>
            <ResumeUpload candidate={candidate} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Applications</CardTitle>
        </CardHeader>
        <CardContent>
          {!applications || applications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No applications recorded for this candidate yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {applications.map((application) => {
                const label = getLabel(application.job_posting_id);
                return (
                  <li key={application.id} className="flex items-center justify-between text-sm">
                    <Link to={`/applications/${application.id}`} className="hover:underline">
                      {label?.positionTitle ?? "Unknown position"}
                    </Link>
                    <ApplicationStatusBadge status={application.status} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {candidate.is_withdrawn ? (
        <Card>
          <CardHeader>
            <CardTitle>Withdrawal details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Withdrawn date</div>
              <div>{candidate.withdrawn_at ? new Date(candidate.withdrawn_at).toLocaleDateString() : "—"}</div>
            </div>
            <div className="col-span-2">
              <div className="text-muted-foreground">Reason</div>
              <div>{candidate.withdrawn_reason ?? "—"}</div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!candidate.is_withdrawn && canWithdraw ? (
        <div>
          <Dialog open={withdrawDialogOpen} onOpenChange={setWithdrawDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive">Withdraw</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Withdraw candidate</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="withdrawn_reason">Reason</Label>
                  <Textarea
                    id="withdrawn_reason"
                    required
                    value={reason.value}
                    onChange={(e) => reason.onChange(e.target.value)}
                    onBlur={reason.onBlur}
                  />
                  {reason.error ? <p className="text-sm text-destructive">{reason.error}</p> : null}
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="destructive"
                  disabled={!reason.value.trim() || withdrawMutation.isPending}
                  onClick={submitWithdraw}
                >
                  {withdrawMutation.isPending ? "Withdrawing…" : "Confirm withdraw"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      ) : null}
    </div>
  );
}
