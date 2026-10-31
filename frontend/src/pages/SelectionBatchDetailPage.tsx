import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import {
  downloadBatchExcel,
  downloadBatchPdf,
  getSelectionBatch,
  recordUniversityApproval,
  withdrawSelectionBatch,
} from "@/api/selectionBatches";
import { useAuth } from "@/auth/AuthContext";
import { BatchStatusBadge } from "@/components/talentPool/BatchStatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

// Mirrors selection_batches.py: require_roles(SUPER_ADMIN, HR_ADMIN, RECRUITMENT_COORDINATOR).
const ALLOWED_ROLES = ["SUPER_ADMIN", "HR_ADMIN", "RECRUITMENT_COORDINATOR"];
const DASH = "—";

export function SelectionBatchDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { user } = useAuth();
  const allowed = !!user && ALLOWED_ROLES.includes(user.role);
  const queryClient = useQueryClient();

  const [approvalOpen, setApprovalOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [refNo, setRefNo] = useState("");
  const [approvedOn, setApprovedOn] = useState("");
  const [reason, setReason] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const query = useQuery({ queryKey: ["selection-batches", "detail", id], queryFn: () => getSelectionBatch(id), enabled: allowed });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["selection-batches"] });
  }

  const approve = useMutation({
    mutationFn: () => recordUniversityApproval(id, { university_ref_no: refNo.trim(), university_approved_on: approvedOn }),
    onSuccess: () => {
      setApprovalOpen(false);
      setDialogError(null);
      refresh();
    },
    onError: (err) => setDialogError(err instanceof ApiError ? err.message : "Could not record the approval"),
  });

  const withdraw = useMutation({
    mutationFn: () => withdrawSelectionBatch(id, reason.trim() || null),
    onSuccess: () => {
      setWithdrawOpen(false);
      setDialogError(null);
      refresh();
    },
    onError: (err) => setDialogError(err instanceof ApiError ? err.message : "Could not withdraw the batch"),
  });

  if (!allowed) {
    return <p className="text-sm text-muted-foreground">You are not allowed to view Selection Batches.</p>;
  }
  if (query.isLoading) return <p className="text-sm text-muted-foreground">Loading{"…"}</p>;
  if (query.isError || !query.data) {
    return (
      <p className="text-sm text-destructive">
        {query.error instanceof Error ? query.error.message : "Could not load this selection batch"}
      </p>
    );
  }

  const batch = query.data;
  const live = batch.status === "SENT_TO_UNIVERSITY";

  async function onDownload(kind: "xlsx" | "pdf") {
    setDownloadError(null);
    try {
      if (kind === "xlsx") await downloadBatchExcel(batch.id, batch.batch_no);
      else await downloadBatchPdf(batch.id, batch.batch_no);
    } catch {
      setDownloadError("Could not download the file.");
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs">
        <Link to="/selection-batches" className="text-brand-primary underline">Selection Batches</Link>
      </p>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold">
            {batch.batch_no} <BatchStatusBadge status={batch.status} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sent on {new Date(batch.sent_on).toLocaleDateString()} {"·"} {batch.member_count}{" "}
            {batch.member_count === 1 ? "person" : "people"}
            {batch.campus_code ? ` · ${batch.campus_code}` : ""}
          </p>
          {batch.note ? <p className="mt-1 text-sm">{batch.note}</p> : null}
          {batch.status === "UNIVERSITY_APPROVED" ? (
            <p className="mt-1 text-sm">
              University reference <span className="font-semibold">{batch.university_ref_no}</span>, approved on{" "}
              {batch.university_approved_on ? new Date(batch.university_approved_on).toLocaleDateString() : DASH}.
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void onDownload("xlsx")}>
            <Download className="size-4" /> Download Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => void onDownload("pdf")}>
            <Download className="size-4" /> Download PDF
          </Button>
          {live ? (
            <>
              <Button size="sm" onClick={() => { setDialogError(null); setApprovalOpen(true); }}>
                Record University approval
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setDialogError(null); setWithdrawOpen(true); }}>
                Withdraw
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {downloadError ? <p className="text-sm text-destructive">{downloadError}</p> : null}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Campus</TableHead>
                <TableHead>Qualification</TableHead>
                <TableHead>Experience</TableHead>
                <TableHead>Panel remarks</TableHead>
                <TableHead>Proposed salary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batch.members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">{member.full_name}</TableCell>
                  <TableCell>{member.designation ?? DASH}</TableCell>
                  <TableCell>{member.department ?? DASH}</TableCell>
                  <TableCell>{member.category ?? DASH}</TableCell>
                  <TableCell>{batch.campus_code ?? DASH}</TableCell>
                  <TableCell>{member.qualification ?? DASH}</TableCell>
                  <TableCell>{member.experience ?? DASH}</TableCell>
                  <TableCell>{member.panel_remarks ?? DASH}</TableCell>
                  <TableCell>{member.proposed_salary ?? DASH}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={approvalOpen} onOpenChange={setApprovalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record University approval</DialogTitle>
            <DialogDescription>Enter the University's reference number and the date it approved this list.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="approval-ref">Reference no.</Label>
              <Input id="approval-ref" value={refNo} onChange={(e) => setRefNo(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="approval-date">Approval date</Label>
              <Input id="approval-date" type="date" value={approvedOn} onChange={(e) => setApprovedOn(e.target.value)} />
            </div>
            {dialogError ? <p role="alert" className="text-sm text-destructive">{dialogError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApprovalOpen(false)}>Cancel</Button>
            <Button onClick={() => approve.mutate()} disabled={approve.isPending || !refNo.trim() || !approvedOn}>
              {approve.isPending ? "Saving…" : "Save approval"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw this batch?</DialogTitle>
            <DialogDescription>
              {batch.batch_no} will be marked withdrawn and its people can be put into a new batch.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="withdraw-reason">Reason (optional)</Label>
            <Textarea id="withdraw-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
            {dialogError ? <p role="alert" className="text-sm text-destructive">{dialogError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWithdrawOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => withdraw.mutate()} disabled={withdraw.isPending}>
              {withdraw.isPending ? "Withdrawing…" : "Withdraw batch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
