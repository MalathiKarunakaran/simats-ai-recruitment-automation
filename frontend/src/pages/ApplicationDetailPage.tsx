import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { getApplication, transitionApplicationStatus, updateApplicationPipelineDetails } from "@/api/applications";
import { getCandidate } from "@/api/candidates";
import { ApiError } from "@/api/client";
import { listInterviews } from "@/api/interviews";
import { listOffers } from "@/api/offers";
import { getResumeScore, screenApplication } from "@/api/resumeScreening";
import {
  APPLICATION_STATUS_ORDER,
  APPLICATION_TERMINAL_STATUSES,
  type ApplicationStatus,
} from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge } from "@/components/applications/StatusBadge";
import { StatusBadge as InterviewStatusBadge } from "@/components/interviews/StatusBadge";
import { JoiningCard } from "@/components/joining/JoiningCard";
import { StatusBadge as OfferStatusBadge } from "@/components/offers/StatusBadge";
import { Badge } from "@/components/ui/badge";
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
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

const WRITE_ROLES = ["RECRUITMENT_OFFICER", "HR_ADMIN", "SUPER_ADMIN"];
const CAN_VIEW_OFFERS_ROLES = ["HR_ADMIN", "SUPER_ADMIN", "MANAGEMENT"];
const CAN_CREATE_OFFER_ROLES = ["HR_ADMIN", "SUPER_ADMIN"];
const CAN_VIEW_JOINING_ROLES = ["HR_ADMIN", "RECRUITMENT_OFFICER", "SUPER_ADMIN"];
const ALL_STATUSES: ApplicationStatus[] = [...APPLICATION_STATUS_ORDER, "REJECTED", "WITHDRAWN"];

export function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { getLabel } = useJobPostingLookup();

  const [error, setError] = useState<string | null>(null);
  const [advanceTo, setAdvanceTo] = useState("");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [forceDialogOpen, setForceDialogOpen] = useState(false);
  const [forceStatus, setForceStatus] = useState("");
  const [forceReason, setForceReason] = useState("");
  const [pipelineDialogOpen, setPipelineDialogOpen] = useState(false);
  const [panelMembers, setPanelMembers] = useState("");
  const [panelResult, setPanelResult] = useState("");
  const [panelRemarks, setPanelRemarks] = useState("");
  const [salaryFixed, setSalaryFixed] = useState("");
  const [calledDate, setCalledDate] = useState("");
  const [interviewScheduledDate, setInterviewScheduledDate] = useState("");
  const [offerGivenDate, setOfferGivenDate] = useState("");
  const [expectedJoiningDate, setExpectedJoiningDate] = useState("");

  const { data: application, isLoading } = useQuery({
    queryKey: ["application", id],
    queryFn: () => getApplication(id!),
    enabled: Boolean(id),
  });

  const { data: candidate } = useQuery({
    queryKey: ["candidate", application?.candidate_id],
    queryFn: () => getCandidate(application!.candidate_id),
    enabled: Boolean(application),
  });

  const canScreen = Boolean(user && WRITE_ROLES.includes(user.role));
  const {
    data: resumeScore,
    error: resumeScoreError,
    isLoading: resumeScoreLoading,
  } = useQuery({
    queryKey: ["resume-score", id],
    queryFn: () => getResumeScore(id!),
    enabled: Boolean(id) && canScreen,
    retry: false,
  });
  const resumeScoreNotFound = resumeScoreError instanceof ApiError && resumeScoreError.status === 404;

  const { data: applicationInterviews } = useQuery({
    queryKey: ["interviews", { applicationId: id }],
    queryFn: () => listInterviews({ applicationId: id }),
    enabled: Boolean(id),
  });

  const canViewOffers = Boolean(user && CAN_VIEW_OFFERS_ROLES.includes(user.role));
  const { data: applicationOffers } = useQuery({
    queryKey: ["offers", { applicationId: id }],
    queryFn: () => listOffers({ applicationId: id }),
    enabled: Boolean(id) && canViewOffers,
  });

  function afterAction() {
    void queryClient.invalidateQueries({ queryKey: ["application", id] });
    void queryClient.invalidateQueries({ queryKey: ["applications"] });
  }

  const advanceMutation = useMutation({
    mutationFn: () => transitionApplicationStatus(id!, { status: advanceTo as ApplicationStatus }),
    onSuccess: () => {
      setError(null);
      setAdvanceTo("");
      afterAction();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Status update failed"),
  });

  const rejectMutation = useMutation({
    mutationFn: () => transitionApplicationStatus(id!, { status: "REJECTED", reason: rejectReason }),
    onSuccess: () => {
      setError(null);
      setRejectDialogOpen(false);
      setRejectReason("");
      afterAction();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Reject failed"),
  });

  const withdrawMutation = useMutation({
    mutationFn: () => transitionApplicationStatus(id!, { status: "WITHDRAWN", reason: withdrawReason }),
    onSuccess: () => {
      setError(null);
      setWithdrawDialogOpen(false);
      setWithdrawReason("");
      afterAction();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Withdraw failed"),
  });

  const forceMutation = useMutation({
    mutationFn: () =>
      transitionApplicationStatus(id!, {
        status: forceStatus as ApplicationStatus,
        reason: forceReason || null,
        force: true,
      }),
    onSuccess: () => {
      setError(null);
      setForceDialogOpen(false);
      setForceStatus("");
      setForceReason("");
      afterAction();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Force correction failed"),
  });

  const pipelineDetailsMutation = useMutation({
    mutationFn: () =>
      updateApplicationPipelineDetails(id!, {
        panel_members: panelMembers || null,
        panel_result: panelResult || null,
        panel_remarks: panelRemarks || null,
        salary_fixed: salaryFixed ? Number(salaryFixed) : null,
        called_date: calledDate || null,
        interview_scheduled_date: interviewScheduledDate || null,
        offer_given_date: offerGivenDate || null,
        expected_joining_date: expectedJoiningDate || null,
      }),
    onSuccess: () => {
      setError(null);
      setPipelineDialogOpen(false);
      afterAction();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Pipeline details update failed"),
  });

  const screenMutation = useMutation({
    mutationFn: () => screenApplication(id!),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["resume-score", id] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Resume screening failed"),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!application || !user) {
    return <Navigate to="/applications" replace />;
  }

  function openPipelineDialog() {
    setPanelMembers(application!.panel_members ?? "");
    setPanelResult(application!.panel_result ?? "");
    setPanelRemarks(application!.panel_remarks ?? "");
    setSalaryFixed(application!.salary_fixed != null ? String(application!.salary_fixed) : "");
    setCalledDate(application!.called_date ?? "");
    setInterviewScheduledDate(application!.interview_scheduled_date ?? "");
    setOfferGivenDate(application!.offer_given_date ?? "");
    setExpectedJoiningDate(application!.expected_joining_date ?? "");
    setPipelineDialogOpen(true);
  }

  const isTerminal = APPLICATION_TERMINAL_STATUSES.has(application.status);
  const currentIndex = APPLICATION_STATUS_ORDER.indexOf(application.status);
  const forwardStatuses = currentIndex >= 0 ? APPLICATION_STATUS_ORDER.slice(currentIndex + 1) : [];

  const canWrite = WRITE_ROLES.includes(user.role);
  const canAdvance = canWrite && !isTerminal && forwardStatuses.length > 0;
  const canReject = canWrite && !isTerminal;
  const canWithdraw = canWrite && !isTerminal;
  const canForce = user.role === "SUPER_ADMIN";

  const joiningConfirmedIndex = APPLICATION_STATUS_ORDER.indexOf("JOINING_CONFIRMED");
  const canViewJoining =
    CAN_VIEW_JOINING_ROLES.includes(user.role) && currentIndex >= joiningConfirmedIndex;

  const label = getLabel(application.job_posting_id);
  const isBusy =
    advanceMutation.isPending || rejectMutation.isPending || withdrawMutation.isPending || forceMutation.isPending;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">
            <Link to={`/job-postings/${application.job_posting_id}`} className="hover:underline">
              {label?.positionTitle ?? "Application"}
            </Link>
          </h1>
          <div className="mt-1">
            <StatusBadge status={application.status} />
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/applications">Back to list</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Candidate</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {candidate ? (
            <Link to={`/candidates/${candidate.id}`} className="font-medium hover:underline">
              {candidate.full_name}
            </Link>
          ) : (
            "—"
          )}
          <div className="text-muted-foreground">{candidate?.email}</div>
        </CardContent>
      </Card>

      {canScreen ? (
        <Card>
          <CardHeader>
            <CardTitle>Resume Screening</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {resumeScoreLoading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : resumeScore ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-muted-foreground">Overall score</div>
                  <div>{resumeScore.overall_recruitment_score}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Eligibility score</div>
                  <div>{resumeScore.eligibility_score}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Skill match</div>
                  <div>{resumeScore.skill_match_pct}%</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Qualification match</div>
                  <div>{resumeScore.qualification_match_pct}%</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Experience match</div>
                  <div>{resumeScore.experience_match_pct}%</div>
                </div>
                <div className="col-span-2">
                  <div className="text-muted-foreground">Extracted skills</div>
                  <div>{resumeScore.extracted_skills.join(", ") || "—"}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-muted-foreground">Rationale</div>
                  <div>{resumeScore.rationale}</div>
                </div>
                {resumeScore.is_duplicate || resumeScore.is_incomplete_profile ? (
                  <div className="col-span-2 flex gap-2">
                    {resumeScore.is_duplicate ? <Badge variant="warning">Possible duplicate</Badge> : null}
                    {resumeScore.is_incomplete_profile ? <Badge variant="warning">Incomplete profile</Badge> : null}
                  </div>
                ) : null}
              </div>
            ) : resumeScoreNotFound ? (
              <p className="text-muted-foreground">Not screened yet.</p>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={!candidate?.resume_storage_key || screenMutation.isPending}
              onClick={() => screenMutation.mutate()}
            >
              {screenMutation.isPending
                ? "Screening…"
                : resumeScore
                  ? "Re-screen resume"
                  : "Screen resume"}
            </Button>
            {!candidate?.resume_storage_key ? (
              <p className="text-xs text-muted-foreground">Candidate has no uploaded resume yet.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {application.qualification_mismatch ? (
        <div className="flex flex-col gap-1 rounded-lg border border-brand-orange/30 bg-brand-orange/10 p-4 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="warning">Qualification Mismatch</Badge>
          </div>
          <p className="text-foreground/90">
            {application.qualification_mismatch_reason ??
              "This application's declared qualification does not match an active eligibility rule for its campus. This is informational only -- it never auto-rejects a candidate."}
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Applied</div>
            <div>{new Date(application.applied_at).toLocaleDateString()}</div>
          </div>
          {application.status === "REJECTED" && application.rejection_reason ? (
            <div className="col-span-2">
              <div className="text-muted-foreground">Rejection reason</div>
              <div>{application.rejection_reason}</div>
            </div>
          ) : null}
          {application.status === "WITHDRAWN" && application.withdrawn_reason ? (
            <div className="col-span-2">
              <div className="text-muted-foreground">Withdrawal reason</div>
              <div>{application.withdrawn_reason}</div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Pipeline Details</CardTitle>
          {canWrite ? (
            <Button variant="outline" size="sm" onClick={openPipelineDialog}>
              Edit
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          {application.panel_members ? (
            <div className="col-span-2">
              <div className="text-muted-foreground">Panel members</div>
              <div>{application.panel_members}</div>
            </div>
          ) : null}
          {application.panel_result ? (
            <div>
              <div className="text-muted-foreground">Panel result</div>
              <div>{application.panel_result}</div>
            </div>
          ) : null}
          {application.salary_fixed != null ? (
            <div>
              <div className="text-muted-foreground">Salary fixed</div>
              <div>{application.salary_fixed}</div>
            </div>
          ) : null}
          {application.panel_remarks ? (
            <div className="col-span-2">
              <div className="text-muted-foreground">Panel remarks</div>
              <div>{application.panel_remarks}</div>
            </div>
          ) : null}
          {application.called_date ? (
            <div>
              <div className="text-muted-foreground">Called date</div>
              <div>{new Date(application.called_date).toLocaleDateString()}</div>
            </div>
          ) : null}
          {application.interview_scheduled_date ? (
            <div>
              <div className="text-muted-foreground">Interview scheduled date</div>
              <div>{new Date(application.interview_scheduled_date).toLocaleDateString()}</div>
            </div>
          ) : null}
          {application.offer_given_date ? (
            <div>
              <div className="text-muted-foreground">Offer given date</div>
              <div>{new Date(application.offer_given_date).toLocaleDateString()}</div>
            </div>
          ) : null}
          {application.expected_joining_date ? (
            <div>
              <div className="text-muted-foreground">Expected joining date</div>
              <div>{new Date(application.expected_joining_date).toLocaleDateString()}</div>
            </div>
          ) : null}
          {!application.panel_members &&
          !application.panel_result &&
          !application.panel_remarks &&
          application.salary_fixed == null &&
          !application.called_date &&
          !application.interview_scheduled_date &&
          !application.offer_given_date &&
          !application.expected_joining_date ? (
            <p className="col-span-2 text-muted-foreground">No pipeline details recorded yet.</p>
          ) : null}
        </CardContent>

        <Dialog open={pipelineDialogOpen} onOpenChange={setPipelineDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit pipeline details</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="panel_members">Panel members</Label>
                <Textarea id="panel_members" value={panelMembers} onChange={(e) => setPanelMembers(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="panel_result">Panel result</Label>
                  <Input id="panel_result" value={panelResult} onChange={(e) => setPanelResult(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="salary_fixed">Salary fixed</Label>
                  <Input
                    id="salary_fixed"
                    type="number"
                    value={salaryFixed}
                    onChange={(e) => setSalaryFixed(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="panel_remarks">Panel remarks</Label>
                <Textarea id="panel_remarks" value={panelRemarks} onChange={(e) => setPanelRemarks(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="called_date">Called date</Label>
                  <Input id="called_date" type="date" value={calledDate} onChange={(e) => setCalledDate(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="interview_scheduled_date">Interview scheduled date</Label>
                  <Input
                    id="interview_scheduled_date"
                    type="date"
                    value={interviewScheduledDate}
                    onChange={(e) => setInterviewScheduledDate(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="offer_given_date">Offer given date</Label>
                  <Input
                    id="offer_given_date"
                    type="date"
                    value={offerGivenDate}
                    onChange={(e) => setOfferGivenDate(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="expected_joining_date">Expected joining date</Label>
                  <Input
                    id="expected_joining_date"
                    type="date"
                    value={expectedJoiningDate}
                    onChange={(e) => setExpectedJoiningDate(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button disabled={pipelineDetailsMutation.isPending} onClick={() => pipelineDetailsMutation.mutate()}>
                {pipelineDetailsMutation.isPending ? "Saving…" : "Save pipeline details"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Interviews</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!applicationInterviews || applicationInterviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No interviews scheduled for this application yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {applicationInterviews.map((interview) => (
                <li key={interview.id} className="flex items-center justify-between text-sm">
                  <Link to={`/interviews/${interview.id}`} className="hover:underline">
                    {interview.interview_type.replace(/_/g, " ")} · {new Date(interview.scheduled_at).toLocaleString()}
                  </Link>
                  <InterviewStatusBadge status={interview.status} />
                </li>
              ))}
            </ul>
          )}
          {canWrite ? (
            <Button variant="outline" size="sm" className="w-fit" asChild>
              <Link to={`/interviews/new?application_id=${application.id}`}>Schedule interview</Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {canViewOffers ? (
        <Card>
          <CardHeader>
            <CardTitle>Offer</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {!applicationOffers || applicationOffers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No offer made for this application yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {applicationOffers.map((offer) => (
                  <li key={offer.id} className="flex items-center justify-between text-sm">
                    <Link to={`/offers/${offer.id}`} className="hover:underline">
                      {offer.salary_currency} {offer.salary_amount}
                    </Link>
                    <OfferStatusBadge status={offer.status} />
                  </li>
                ))}
              </ul>
            )}
            {user && CAN_CREATE_OFFER_ROLES.includes(user.role) ? (
              <Button variant="outline" size="sm" className="w-fit" asChild>
                <Link to={`/offers/new?application_id=${application.id}`}>Make an offer</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {canViewJoining ? <JoiningCard application={application} /> : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-wrap items-end gap-2">
        {canAdvance ? (
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>Advance to</Label>
              <Select value={advanceTo} onValueChange={setAdvanceTo}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Select next status" />
                </SelectTrigger>
                <SelectContent>
                  {forwardStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button disabled={isBusy || !advanceTo} onClick={() => advanceMutation.mutate()}>
              {advanceMutation.isPending ? "Updating…" : "Update status"}
            </Button>
          </div>
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
                <DialogTitle>Reject application</DialogTitle>
              </DialogHeader>
              {application.qualification_mismatch ? (
                <div className="mb-4 flex flex-col gap-1 rounded-lg border border-brand-orange/30 bg-brand-orange/10 p-3 text-sm">
                  <Badge variant="warning" className="w-fit">
                    Qualification Mismatch
                  </Badge>
                  <p className="text-foreground/90">
                    {application.qualification_mismatch_reason ??
                      "This application's declared qualification does not match an active eligibility rule for its campus."}
                  </p>
                </div>
              ) : null}
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

        {canWithdraw ? (
          <Dialog open={withdrawDialogOpen} onOpenChange={setWithdrawDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" disabled={isBusy}>
                Withdraw
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Withdraw application</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="withdraw_reason">Reason</Label>
                <Textarea
                  id="withdraw_reason"
                  required
                  value={withdrawReason}
                  onChange={(e) => setWithdrawReason(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button
                  disabled={!withdrawReason.trim() || withdrawMutation.isPending}
                  onClick={() => withdrawMutation.mutate()}
                >
                  {withdrawMutation.isPending ? "Withdrawing…" : "Confirm withdraw"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}

        {canForce ? (
          <Dialog open={forceDialogOpen} onOpenChange={setForceDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" disabled={isBusy}>
                Force correct status
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Force correct status</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>New status</Label>
                  <Select value={forceStatus} onValueChange={setForceStatus}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a status" />
                    </SelectTrigger>
                    <SelectContent>
                      {ALL_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {status.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="force_reason">Reason (optional)</Label>
                  <Textarea
                    id="force_reason"
                    value={forceReason}
                    onChange={(e) => setForceReason(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button disabled={!forceStatus || forceMutation.isPending} onClick={() => forceMutation.mutate()}>
                  {forceMutation.isPending ? "Applying…" : "Apply correction"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </div>
  );
}
