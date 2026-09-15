import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { getJobAd, getQrCodeBlob } from "@/api/jobDistribution";
import {
  approveJobPosting,
  closeJobPosting,
  getJobPosting,
  pauseJobPosting,
  publishJobPosting,
  rankCandidates,
  resumeJobPosting,
  returnJobPostingToDraft,
  submitJobPostingForReview,
} from "@/api/jobPostings";
import type { JobPostingRead, JobPostingStatus, Permission } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { DetailItem } from "@/components/job-postings/DetailItem";
import { JobContentCard } from "@/components/job-postings/JobContentCard";
import { PostingAuditCard } from "@/components/job-postings/PostingAuditCard";
import { PostingChannelsPanel } from "@/components/job-postings/PostingChannelsPanel";
import { PostingHistoryCard } from "@/components/job-postings/PostingHistoryCard";
import { PostingStatusBadge } from "@/components/job-postings/PostingStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CATEGORY_LABELS, formatDate, formatEmploymentType } from "@/lib/careersDisplay";

const RANKED_CANDIDATES_COLUMN_COUNT = 5;

const STEPS: { label: string; statuses: JobPostingStatus[] }[] = [
  { label: "Draft", statuses: ["DRAFT"] },
  { label: "In review", statuses: ["READY_FOR_REVIEW"] },
  { label: "Approved", statuses: ["APPROVED"] },
  { label: "Published", statuses: ["PUBLISHED", "PAUSED"] },
];

const NEXT_STEP: Record<JobPostingStatus, string> = {
  DRAFT: "Write and check the job content, choose the channels, then submit it for review.",
  READY_FOR_REVIEW: "Waiting for approval. The reviewer approves it or returns it to draft.",
  APPROVED: "Approved. Publishing puts it on the careers page and posts the careers channel.",
  PUBLISHED: "Live on the careers page and taking applications.",
  PAUSED: "Paused: not advertised, but walk-in applications can still be recorded.",
  CLOSED: "Closed together with its vacancy.",
};

function WorkflowSteps({ status }: { status: JobPostingStatus }) {
  const current = STEPS.findIndex((step) => step.statuses.includes(status));
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Posting workflow">
      {STEPS.map((step, index) => {
        const done = current >= 0 && index < current;
        const active = index === current;
        return (
          <li key={step.label} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            <span
              className={
                active
                  ? "rounded-full bg-primary px-2.5 py-1 font-medium text-primary-foreground"
                  : done
                    ? "rounded-full bg-brand-success/15 px-2.5 py-1 text-brand-success"
                    : "rounded-full bg-muted px-2.5 py-1 text-muted-foreground"
              }
            >
              {step.label}
            </span>
            {index < STEPS.length - 1 ? <span className="text-muted-foreground">→</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function JobPostingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();

  // Every gate mirrors a require_permission on the backend (Super Admin
  // passes all of them inside hasPermission).
  const can = (permission: Permission) => hasPermission?.(permission) ?? false;
  const canEdit = can("EDIT_JOB_POSTING");
  const canApprove = can("APPROVE_JOB_POSTING");
  const canPublish = can("PUBLISH_JOB_POSTING");
  const canClose = can("CLOSE_VACANCY");
  const canDistribute = can("JOB_DISTRIBUTION");
  const canReview = canDistribute || can("REVIEW_POSTING_CHANNELS");
  const canViewActivity = can("ACTIVITY_LOG");

  const [error, setError] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("");

  const { data: jobPosting, isLoading } = useQuery({
    queryKey: ["job-posting", id],
    queryFn: () => getJobPosting(id!),
    enabled: Boolean(id),
  });
  const { data: rankedCandidates } = useQuery({
    queryKey: ["candidate-ranking", id],
    queryFn: () => rankCandidates(id!),
    enabled: Boolean(id),
  });
  const { data: jobAd } = useQuery({
    queryKey: ["job-ad", id],
    queryFn: () => getJobAd(id!),
    enabled: Boolean(id) && canDistribute,
  });

  useEffect(() => {
    return () => {
      if (qrCodeUrl) URL.revokeObjectURL(qrCodeUrl);
    };
  }, [qrCodeUrl]);

  function refreshPosting() {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ["job-posting", id] });
    void queryClient.invalidateQueries({ queryKey: ["job-ad", id] });
    void queryClient.invalidateQueries({ queryKey: ["job-postings"] });
    void queryClient.invalidateQueries({ queryKey: ["posting-channels", id] });
    void queryClient.invalidateQueries({ queryKey: ["posting-history", id] });
    void queryClient.invalidateQueries({ queryKey: ["audit-logs", "JobPosting", id] });
  }
  function fail(fallback: string) {
    return (err: unknown) => setError(err instanceof ApiError ? err.message : fallback);
  }
  function lifecycle(fn: (postingId: string) => Promise<JobPostingRead>, done: string, fallback: string) {
    return {
      mutationFn: () => fn(id!),
      onSuccess: () => {
        refreshPosting();
        toast.success(done);
      },
      onError: fail(fallback),
    };
  }

  const submitMutation = useMutation(lifecycle(submitJobPostingForReview, "Submitted for review.", "Could not submit for review"));
  const approveMutation = useMutation(lifecycle(approveJobPosting, "Job posting approved.", "Could not approve the posting"));
  const publishMutation = useMutation(
    lifecycle(publishJobPosting, "Published. It is on the careers page now.", "Could not publish the posting"),
  );
  const pauseMutation = useMutation(
    lifecycle(pauseJobPosting, "Posting paused. Walk-in applications can still be recorded.", "Could not pause the posting"),
  );
  const resumeMutation = useMutation(lifecycle(resumeJobPosting, "Posting resumed.", "Could not resume the posting"));
  const returnMutation = useMutation({
    mutationFn: () => returnJobPostingToDraft(id!, returnReason.trim() || null),
    onSuccess: () => {
      refreshPosting();
      setReturnOpen(false);
      setReturnReason("");
      toast.success("Returned to draft.");
    },
    onError: fail("Could not return the posting to draft"),
  });
  const closeMutation = useMutation({
    mutationFn: () => closeJobPosting(id!),
    onSuccess: () => {
      refreshPosting();
      setCloseOpen(false);
      toast.success("Posting and vacancy closed.");
    },
    onError: fail("Could not close the posting"),
  });
  const qrCodeMutation = useMutation({
    mutationFn: () => getQrCodeBlob(id!),
    onSuccess: (blob) => {
      setError(null);
      setQrCodeUrl(URL.createObjectURL(blob));
    },
    onError: fail("QR code generation failed"),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!jobPosting) {
    return <Navigate to="/job-postings" replace />;
  }

  const status = jobPosting.status;
  const closed = status === "CLOSED";
  const published = jobPosting.published_at !== null;
  const busy = [submitMutation, approveMutation, publishMutation, pauseMutation, resumeMutation, returnMutation, closeMutation].some(
    (m) => m.isPending,
  );
  const deadlinePassed = status === "PUBLISHED" && !jobPosting.is_accepting_applications;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold">{jobPosting.ad_title ?? jobPosting.position_title}</h1>
            <PostingStatusBadge status={status} />
            {deadlinePassed ? <Badge variant="warning">Deadline passed</Badge> : null}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {jobPosting.posting_number ? <span className="font-mono">{jobPosting.posting_number}</span> : null}
            <span>
              {jobPosting.campus_code} · {jobPosting.department_name}
            </span>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/job-postings">Back to job postings</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <WorkflowSteps status={status} />
            <div className="flex flex-wrap gap-2">
              {canEdit && status === "DRAFT" ? (
                <Button size="sm" disabled={busy} onClick={() => submitMutation.mutate()}>
                  Submit for review
                </Button>
              ) : null}
              {canApprove && status === "READY_FOR_REVIEW" ? (
                <Button size="sm" disabled={busy} onClick={() => approveMutation.mutate()}>
                  Approve
                </Button>
              ) : null}
              {canPublish && status === "APPROVED" ? (
                <Button size="sm" disabled={busy} onClick={() => publishMutation.mutate()}>
                  Publish
                </Button>
              ) : null}
              {(canEdit || canApprove) && (status === "READY_FOR_REVIEW" || status === "APPROVED") ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setReturnOpen(true)}>
                  Return to draft
                </Button>
              ) : null}
              {canEdit && status === "PUBLISHED" ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => pauseMutation.mutate()}>
                  Pause
                </Button>
              ) : null}
              {canEdit && status === "PAUSED" ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => resumeMutation.mutate()}>
                  Resume
                </Button>
              ) : null}
              {canClose && !closed ? (
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => setCloseOpen(true)}>
                  Close
                </Button>
              ) : null}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{NEXT_STEP[status]}</p>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Job information</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <DetailItem label="Job posting number">
                  {jobPosting.posting_number ? <span className="font-mono">{jobPosting.posting_number}</span> : null}
                </DetailItem>
                <DetailItem label="Source vacancy request">
                  <span className="flex flex-col">
                    {jobPosting.vacancy_request_ref ? <span className="font-mono">{jobPosting.vacancy_request_ref}</span> : null}
                    <Link to={`/vacancy-requests/${jobPosting.vacancy_request_id}`} className="text-xs text-primary hover:underline">
                      View vacancy request
                    </Link>
                  </span>
                </DetailItem>
                <DetailItem label="Requisition number">
                  {jobPosting.requisition_number ? <span className="font-mono">{jobPosting.requisition_number}</span> : null}
                </DetailItem>
                <DetailItem label="Campus">
                  {jobPosting.campus_code} · {jobPosting.campus_name}
                </DetailItem>
                <DetailItem label="Department">{jobPosting.department_name}</DetailItem>
                <DetailItem label="Category">{CATEGORY_LABELS[jobPosting.role_category]}</DetailItem>
                <DetailItem label="Designation">{jobPosting.designation_name}</DetailItem>
                <DetailItem label="Location">{jobPosting.location_label}</DetailItem>
                <DetailItem label="Employment type">
                  {jobPosting.employment_type ? formatEmploymentType(jobPosting.employment_type) : null}
                </DetailItem>
                <DetailItem label="Priority">{formatEmploymentType(jobPosting.priority)}</DetailItem>
                <DetailItem label="Required by">{jobPosting.required_by ? formatDate(jobPosting.required_by) : null}</DetailItem>
                <DetailItem label="Current status">
                  <PostingStatusBadge status={status} />
                </DetailItem>
              </dl>
            </CardContent>
          </Card>

          <JobContentCard key={jobPosting.updated_at} jobPosting={jobPosting} canEdit={canEdit} onChanged={refreshPosting} />

          <PostingChannelsPanel
            jobPosting={jobPosting}
            canPost={canDistribute}
            canReview={canReview}
            applyUrl={published ? (jobAd?.apply_url ?? null) : null}
          />

          {canDistribute ? <PostingHistoryCard jobPostingId={jobPosting.id} /> : null}

          <Card>
            <CardHeader>
              <CardTitle>Ranked Candidates</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Candidate</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Overall score</TableHead>
                    <TableHead>Eligibility score</TableHead>
                    <TableHead>Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!rankedCandidates || rankedCandidates.length === 0 ? (
                    <TableEmpty colSpan={RANKED_CANDIDATES_COLUMN_COUNT}>No applications for this posting yet.</TableEmpty>
                  ) : (
                    rankedCandidates.map((row) => (
                      <TableRow key={row.application_id}>
                        <TableCell>
                          <Link to={`/applications/${row.application_id}`} className="font-medium hover:underline">
                            {row.candidate_full_name}
                          </Link>
                          <div className="text-xs text-muted-foreground">{row.candidate_email}</div>
                        </TableCell>
                        <TableCell>{row.application_status.replace(/_/g, " ")}</TableCell>
                        <TableCell>{row.overall_recruitment_score ?? "—"}</TableCell>
                        <TableCell>{row.eligibility_score ?? "—"}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {row.is_duplicate ? <Badge variant="warning">Duplicate</Badge> : null}
                            {row.is_incomplete_profile ? <Badge variant="warning">Incomplete</Badge> : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Positions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: "Requested", value: jobPosting.positions_requested },
                  { label: "Filled", value: jobPosting.positions_filled },
                  { label: "Remaining", value: jobPosting.positions_remaining },
                ].map((tile) => (
                  <div key={tile.label} className="rounded-md border border-border px-2 py-3" data-testid={`positions-${tile.label.toLowerCase()}`}>
                    <div className="text-xl font-semibold">{tile.value}</div>
                    <div className="text-xs text-muted-foreground">{tile.label}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Counted from the vacancy's hiring slots. These cannot be edited.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Application details</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <dl className="grid gap-3">
                <DetailItem label="Application deadline">
                  {jobPosting.apply_deadline ? formatDate(jobPosting.apply_deadline) : "No deadline"}
                </DetailItem>
                <DetailItem label="Accepting applications">
                  {jobPosting.is_accepting_applications ? "Yes" : deadlinePassed ? "No, the deadline has passed" : "No"}
                </DetailItem>
                <DetailItem label="Contact email">{jobPosting.contact_email}</DetailItem>
                <DetailItem label="Public job page">
                  {!published ? (
                    <span className="text-muted-foreground">Available once published</span>
                  ) : jobAd ? (
                    <a
                      href={jobAd.apply_url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs break-all text-brand-plum underline dark:text-brand-plum-bright"
                    >
                      {jobAd.apply_url}
                    </a>
                  ) : null}
                </DetailItem>
              </dl>
              {canDistribute && published && !closed ? (
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">QR code (apply link)</div>
                  {qrCodeUrl ? (
                    <div className="flex items-center gap-3">
                      <img src={qrCodeUrl} alt="Apply QR code" className="h-32 w-32 rounded-md border border-border" />
                      <Button variant="outline" size="sm" asChild>
                        <a href={qrCodeUrl} download={`job-posting-${jobPosting.id}-qr.png`}>
                          Download PNG
                        </a>
                      </Button>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" disabled={qrCodeMutation.isPending} onClick={() => qrCodeMutation.mutate()}>
                      {qrCodeMutation.isPending ? "Generating…" : "Generate QR code"}
                    </Button>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <PostingAuditCard jobPosting={jobPosting} canViewActivity={canViewActivity} />
        </div>
      </div>

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return to draft?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The posting goes back to draft and must be submitted and approved again before it can be published.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="return_reason">Reason (optional)</Label>
            <Textarea id="return_reason" rows={3} maxLength={1000} value={returnReason} onChange={(e) => setReturnReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnOpen(false)}>
              Cancel
            </Button>
            <Button disabled={returnMutation.isPending} onClick={() => returnMutation.mutate()}>
              {returnMutation.isPending ? "Returning…" : "Return to draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close this posting?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This closes the vacancy as well: open hiring slots are released and every channel listing is retired. Only
            a Super Admin can reopen it. To stop advertising for a while, use Pause instead.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseOpen(false)}>
              Keep open
            </Button>
            <Button variant="destructive" disabled={closeMutation.isPending} onClick={() => closeMutation.mutate()}>
              {closeMutation.isPending ? "Closing…" : "Close posting and vacancy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
