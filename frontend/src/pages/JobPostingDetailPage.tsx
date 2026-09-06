import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { getJobAd, getQrCodeBlob } from "@/api/jobDistribution";
import {
  closeJobPosting,
  getJobPosting,
  pauseJobPosting,
  rankCandidates,
  resumeJobPosting,
  updateJobPosting,
} from "@/api/jobPostings";
import { useAuth } from "@/auth/AuthContext";
import { PostingChannelsPanel } from "@/components/job-postings/PostingChannelsPanel";
import { PostingStatusBadge } from "@/components/job-postings/PostingStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

const RANKED_CANDIDATES_COLUMN_COUNT = 5;

// Mirrors app/api/v1/routers/job_distribution.py: list/post/attempts are
// gated by require_permission(JOB_DISTRIBUTION); these roles hold it by
// default (app/services/permissions.py), anyone else only by grant.
const DISTRIBUTE_ROLES = ["RECRUITMENT_OFFICER", "HR_ADMIN", "SUPER_ADMIN"];
// Mirrors app/services/permissions.py defaults for EDIT_JOB_POSTING /
// CLOSE_VACANCY. Super Admin bypasses every permission check.
const EDIT_ROLES = ["RECRUITMENT_OFFICER", "HR_ADMIN", "SUPER_ADMIN"];
const CLOSE_ROLES = ["HR_ADMIN", "SUPER_ADMIN"];

export function JobPostingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();

  const canDistribute = Boolean(user && (DISTRIBUTE_ROLES.includes(user.role) || hasPermission?.("JOB_DISTRIBUTION")));
  const canReview = Boolean(
    user &&
      (DISTRIBUTE_ROLES.includes(user.role) ||
        hasPermission?.("JOB_DISTRIBUTION") ||
        hasPermission?.("REVIEW_POSTING_CHANNELS")),
  );
  const canEdit = Boolean(user && (EDIT_ROLES.includes(user.role) || hasPermission?.("EDIT_JOB_POSTING")));
  const canClose = Boolean(user && (CLOSE_ROLES.includes(user.role) || hasPermission?.("CLOSE_VACANCY")));

  const [error, setError] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [adTitle, setAdTitle] = useState("");
  const [adBody, setAdBody] = useState("");
  const [applyDeadline, setApplyDeadline] = useState("");
  const [contactEmail, setContactEmail] = useState("");

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

  const { data: jobAd, isLoading: jobAdLoading } = useQuery({
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
  }
  function fail(fallback: string) {
    return (err: unknown) => setError(err instanceof ApiError ? err.message : fallback);
  }

  const qrCodeMutation = useMutation({
    mutationFn: () => getQrCodeBlob(id!),
    onSuccess: (blob) => {
      setError(null);
      setQrCodeUrl(URL.createObjectURL(blob));
    },
    onError: fail("QR code generation failed"),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      updateJobPosting(id!, {
        ad_title: adTitle.trim(),
        ad_body: adBody.trim(),
        apply_deadline: applyDeadline || null,
        contact_email: contactEmail.trim() || null,
      }),
    onSuccess: () => {
      refreshPosting();
      setEditOpen(false);
      toast.success("Advertisement saved.");
    },
    onError: fail("Could not save the advertisement"),
  });
  const pauseMutation = useMutation({
    mutationFn: () => pauseJobPosting(id!),
    onSuccess: () => {
      refreshPosting();
      toast.success("Posting paused. Walk-in applications can still be recorded.");
    },
    onError: fail("Could not pause the posting"),
  });
  const resumeMutation = useMutation({
    mutationFn: () => resumeJobPosting(id!),
    onSuccess: () => {
      refreshPosting();
      toast.success("Posting resumed.");
    },
    onError: fail("Could not resume the posting"),
  });
  const closeMutation = useMutation({
    mutationFn: () => closeJobPosting(id!),
    onSuccess: () => {
      refreshPosting();
      setCloseOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["posting-channels", id] });
      toast.success("Posting and vacancy closed.");
    },
    onError: fail("Could not close the posting"),
  });

  function openEdit() {
    if (!jobPosting) return;
    setAdTitle(jobPosting.ad_title ?? jobPosting.position_title);
    setAdBody(jobPosting.ad_body ?? jobAd?.body ?? "");
    setApplyDeadline(jobPosting.apply_deadline ?? "");
    setContactEmail(jobPosting.contact_email ?? "");
    setError(null);
    setEditOpen(true);
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!jobPosting) {
    return <Navigate to="/job-postings" replace />;
  }

  const closed = jobPosting.status === "CLOSED";
  const lifecycleBusy = pauseMutation.isPending || resumeMutation.isPending || closeMutation.isPending;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold">{jobPosting.ad_title ?? jobPosting.position_title}</h1>
            <PostingStatusBadge status={jobPosting.status} />
            {!closed && !jobPosting.is_accepting_applications ? <Badge variant="warning">Deadline passed</Badge> : null}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {jobPosting.posting_number ? <span className="font-mono">{jobPosting.posting_number}</span> : null}
            {jobPosting.requisition_number ? <span className="font-mono">{jobPosting.requisition_number}</span> : null}
            <Link to={`/vacancy-requests/${jobPosting.vacancy_request_id}`} className="hover:underline">
              View vacancy request
            </Link>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/job-postings">Back to job postings</Link>
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Posting</CardTitle>
          {!closed && (canEdit || canClose) ? (
            <div className="flex flex-wrap gap-2">
              {canEdit && jobPosting.status === "PUBLISHED" ? (
                <Button variant="outline" size="sm" disabled={lifecycleBusy} onClick={() => pauseMutation.mutate()}>
                  Pause
                </Button>
              ) : null}
              {canEdit && jobPosting.status === "PAUSED" ? (
                <Button variant="outline" size="sm" disabled={lifecycleBusy} onClick={() => resumeMutation.mutate()}>
                  Resume
                </Button>
              ) : null}
              {canClose ? (
                <Button variant="destructive" size="sm" disabled={lifecycleBusy} onClick={() => setCloseOpen(true)}>
                  Close
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Published</div>
            <div>{new Date(jobPosting.published_at).toLocaleDateString()}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Positions (needed / filled)</div>
            <div>
              {jobPosting.requested_count} / {jobPosting.available_count}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Apply by</div>
            <div>{jobPosting.apply_deadline ? new Date(jobPosting.apply_deadline).toLocaleDateString() : "No deadline"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Contact</div>
            <div>{jobPosting.contact_email ?? "—"}</div>
          </div>
          {jobPosting.closed_at ? (
            <div>
              <div className="text-muted-foreground">Closed</div>
              <div>{new Date(jobPosting.closed_at).toLocaleDateString()}</div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {canDistribute ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Advertisement</CardTitle>
            <div className="flex gap-2">
              {jobAd ? (
                <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(jobAd.body)}>
                  Copy
                </Button>
              ) : null}
              {canEdit && !closed ? (
                <Button variant="outline" size="sm" onClick={openEdit}>
                  Edit
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 text-sm">
            <div>
              {jobAdLoading ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : jobAd ? (
                <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-sans text-xs">
                  {jobAd.body}
                </pre>
              ) : (
                <p className="text-muted-foreground">No job ad available.</p>
              )}
              {jobPosting.last_edited_at ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Last edited {new Date(jobPosting.last_edited_at).toLocaleString()}
                </p>
              ) : null}
            </div>

            <div>
              <div className="mb-1 text-muted-foreground">QR code (apply link)</div>
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
          </CardContent>
        </Card>
      ) : null}

      <PostingChannelsPanel jobPosting={jobPosting} canPost={canDistribute} canReview={canReview} />

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

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit advertisement</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ad_title">Title</Label>
              <Input id="ad_title" value={adTitle} onChange={(e) => setAdTitle(e.target.value)} maxLength={200} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ad_body">Advertisement text</Label>
              <Textarea id="ad_body" rows={10} value={adBody} onChange={(e) => setAdBody(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="apply_deadline">Apply by (optional)</Label>
                <Input id="apply_deadline" type="date" value={applyDeadline} onChange={(e) => setApplyDeadline(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="contact_email">Contact email (optional)</Label>
                <Input id="contact_email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
              </div>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saveMutation.isPending || !adTitle.trim() || !adBody.trim()} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending ? "Saving…" : "Save"}
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
            This closes the vacancy as well: open hiring slots are released, every channel listing is retired, and
            it cannot be reopened. To stop advertising for a while, use Pause instead.
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
