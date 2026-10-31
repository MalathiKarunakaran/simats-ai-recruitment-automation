import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { getCandidate } from "@/api/candidates";
import { ApiError } from "@/api/client";
import {
  getProvisionalOrder,
  issueProvisionalOrder,
  openProvisionalOrderLetter,
  openProvisionalOrderSignedCopy,
  uploadProvisionalOrderSignedCopy,
} from "@/api/joining";
import { JOINING_DOCUMENT_ACCEPT } from "@/api/types";
import type { ApplicationRead, ApplicationStatus } from "@/api/types";
import { formatDate } from "@/components/joining/postHandover";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Statuses at which an order can exist. Applications oriented before the
// order step existed have none -- the GET 404s and nothing is shown.
const ORDER_STATUSES = new Set<ApplicationStatus>([
  "PROVISIONAL_ORDER_ISSUED",
  "ORIENTATION_COMPLETE",
  "HANDED_OVER_TO_HOD",
  "HOD_REVIEW_COMPLETE",
  "PERMANENT_ORDER_ISSUED",
]);


/** Provisional appointment order (docs/specs/provisional-order-and-allotment.md):
 * issued at DEPARTMENT_ROOM_ALLOTTED (the letter prints the allotted
 * department -- user decision 31-Oct), with the address to print prefilled
 * from the candidate and editable; then the letter can be downloaded and the
 * signed copy uploaded. */
export function ProvisionalOrderSection({
  application,
  canWrite,
  onChanged,
}: {
  application: ApplicationRead;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const hasOrder = ORDER_STATUSES.has(application.status);
  const canIssue = canWrite && application.status === "DEPARTMENT_ROOM_ALLOTTED";
  // null = not touched yet, so the box shows the candidate's address.
  const [address, setAddress] = useState<string | null>(null);

  const { data: candidate } = useQuery({
    queryKey: ["candidate", application.candidate_id],
    queryFn: () => getCandidate(application.candidate_id),
    enabled: canIssue,
  });

  const { data: order } = useQuery({
    queryKey: ["provisional-order", application.id],
    queryFn: () => getProvisionalOrder(application.id),
    enabled: hasOrder,
    retry: false,
  });

  function refresh() {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ["provisional-order", application.id] });
    // Issuing can save the typed address to a candidate who had none.
    void queryClient.invalidateQueries({ queryKey: ["candidate", application.candidate_id] });
    onChanged();
  }

  const issueMutation = useMutation({
    // Untouched box: leave address out and the backend uses the candidate's.
    mutationFn: () => issueProvisionalOrder(application.id, address === null ? {} : { address }),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not issue the provisional order"),
  });
  const letterMutation = useMutation({
    mutationFn: () => openProvisionalOrderLetter(application.id),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not open the letter"),
  });
  const signedCopyMutation = useMutation({
    mutationFn: () => openProvisionalOrderSignedCopy(application.id),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not open the signed copy"),
  });
  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadProvisionalOrderSignedCopy(application.id, file),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Upload failed"),
  });

  if (application.status === "DEPARTMENT_ROOM_ALLOTTED") {
    if (!canIssue) return null;
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="order_address">Address on the letter</Label>
          <Textarea
            id="order_address"
            rows={3}
            className="max-w-md"
            value={address ?? candidate?.address ?? ""}
            onChange={(e) => setAddress(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Printed under the name. Left empty, the letter has no address line.
            {candidate && !candidate.address ? " Saved to the candidate as well." : ""}
          </p>
        </div>
        <Button className="w-fit" disabled={issueMutation.isPending} onClick={() => issueMutation.mutate()}>
          {issueMutation.isPending ? "Issuing…" : "Issue provisional order"}
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    );
  }

  if (!hasOrder || !order) return null;

  return (
    <section aria-label="Provisional order" className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-muted-foreground">Provisional order no.</div>
          <div className="font-medium">{order.order_number}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Order date</div>
          <div>{formatDate(order.order_date)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Department</div>
          <div>{order.department_name}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Probation ends</div>
          {/* The latest "Extend probation" HOD review wins over the order's. */}
          <div>{formatDate(order.current_probation_end_date ?? order.probation_end_date)}</div>
          {order.current_probation_end_date && order.current_probation_end_date !== order.probation_end_date ? (
            <div className="text-xs text-muted-foreground">
              Extended; the order said {formatDate(order.probation_end_date)}
            </div>
          ) : null}
        </div>
        <div>
          <div className="text-muted-foreground">Signed copy</div>
          <div>{order.signed_copy_uploaded_at ? "Uploaded" : "Not uploaded yet"}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={letterMutation.isPending} onClick={() => letterMutation.mutate()}>
          Download letter
        </Button>
        {order.signed_copy_uploaded_at ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={signedCopyMutation.isPending}
            onClick={() => signedCopyMutation.mutate()}
          >
            View signed copy
          </Button>
        ) : null}
        {canWrite ? (
          <>
            <Button variant="outline" size="sm" asChild disabled={uploadMutation.isPending}>
              <label htmlFor={`signed-copy-${application.id}`} className="cursor-pointer">
                {order.signed_copy_uploaded_at ? "Replace signed copy" : "Upload signed copy"}
              </label>
            </Button>
            <input
              id={`signed-copy-${application.id}`}
              type="file"
              accept={JOINING_DOCUMENT_ACCEPT}
              className="sr-only"
              aria-label="Upload signed copy"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadMutation.mutate(file);
                e.target.value = "";
              }}
            />
          </>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
