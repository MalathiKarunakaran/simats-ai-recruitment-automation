import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

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
import { Button } from "@/components/ui/button";

// Statuses at which an order can exist. Applications allotted before the
// order step existed have none -- the GET 404s and nothing is shown.
const ORDER_STATUSES = new Set<ApplicationStatus>([
  "PROVISIONAL_ORDER_ISSUED",
  "DEPARTMENT_ROOM_ALLOTTED",
  "ORIENTATION_COMPLETE",
  "HANDED_OVER_TO_HOD",
]);

function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}-${month}-${year}`;
}

/** Provisional appointment order (docs/specs/provisional-order-and-allotment.md):
 * issued at JOINED, then the letter can be downloaded and the signed copy
 * uploaded. */
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

  const { data: order } = useQuery({
    queryKey: ["provisional-order", application.id],
    queryFn: () => getProvisionalOrder(application.id),
    enabled: hasOrder,
    retry: false,
  });

  function refresh() {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ["provisional-order", application.id] });
    onChanged();
  }

  const issueMutation = useMutation({
    mutationFn: () => issueProvisionalOrder(application.id),
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

  if (application.status === "JOINED") {
    if (!canWrite) return null;
    return (
      <div className="flex flex-col gap-2">
        <Button className="w-fit" disabled={issueMutation.isPending} onClick={() => issueMutation.mutate()}>
          {issueMutation.isPending ? "Issuing…" : "Issue provisional order"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Department and room are allotted after the provisional order is issued.
        </p>
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
          <div className="text-muted-foreground">Probation ends</div>
          <div>{formatDate(order.probation_end_date)}</div>
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
