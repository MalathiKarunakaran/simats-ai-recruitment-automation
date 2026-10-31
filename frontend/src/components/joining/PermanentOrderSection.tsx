import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { getPermanentOrder, openPermanentOrderFile, recordPermanentOrder, uploadPermanentOrderFile } from "@/api/joining";
import { JOINING_DOCUMENT_ACCEPT } from "@/api/types";
import type { ApplicationRead } from "@/api/types";
import { formatDate } from "@/components/joining/postHandover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Permanent order (docs/specs/hod-review-and-permanent-order.md): issued by
 * the Registrar's office and only RECORDED here, at HOD_REVIEW_COMPLETE --
 * reference number, order date, date issued to the faculty member, and the
 * signed order. No letter is generated. */
export function PermanentOrderSection({
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
  const [refNo, setRefNo] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [issuedOn, setIssuedOn] = useState("");

  const isIssued = application.status === "PERMANENT_ORDER_ISSUED";
  const { data: order } = useQuery({
    queryKey: ["permanent-order", application.id],
    queryFn: () => getPermanentOrder(application.id),
    enabled: isIssued,
    retry: false,
  });

  function refresh() {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ["permanent-order", application.id] });
    void queryClient.invalidateQueries({ queryKey: ["onboarding-probation"] });
    onChanged();
  }

  const recordMutation = useMutation({
    mutationFn: () =>
      recordPermanentOrder(application.id, {
        registrar_ref_no: refNo.trim(),
        order_date: orderDate,
        issued_to_faculty_on: issuedOn,
      }),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not record the permanent order"),
  });
  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadPermanentOrderFile(application.id, file),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Upload failed"),
  });
  const openMutation = useMutation({
    mutationFn: () => openPermanentOrderFile(application.id),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not open the signed order"),
  });

  if (application.status === "HOD_REVIEW_COMPLETE") {
    if (!canWrite) return null;
    const issuedBeforeOrder = Boolean(orderDate && issuedOn && issuedOn < orderDate);
    return (
      <section aria-label="Record permanent order" className="flex flex-col gap-3 rounded-md border border-border p-3 text-sm">
        <h3 className="font-medium">Record permanent order</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="permanent_ref_no">Registrar ref. no.</Label>
            <Input id="permanent_ref_no" value={refNo} onChange={(e) => setRefNo(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="permanent_order_date">Order date</Label>
            <Input id="permanent_order_date" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="permanent_issued_on">Issued to faculty on</Label>
            <Input id="permanent_issued_on" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
          </div>
        </div>
        {issuedBeforeOrder ? (
          <p className="text-xs text-destructive">The issue date cannot be before the order date.</p>
        ) : null}
        <Button
          className="w-fit"
          disabled={recordMutation.isPending || !refNo.trim() || !orderDate || !issuedOn || issuedBeforeOrder}
          onClick={() => recordMutation.mutate()}
        >
          {recordMutation.isPending ? "Recording…" : "Record permanent order"}
        </Button>
        <p className="text-xs text-muted-foreground">The signed order can be uploaded once it is recorded.</p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </section>
    );
  }

  if (!isIssued || !order) return null;

  return (
    <section aria-label="Permanent order" className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-muted-foreground">Permanent order ref. no.</div>
          <div className="font-medium">{order.registrar_ref_no}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Order date</div>
          <div>{formatDate(order.order_date)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Issued to faculty on</div>
          <div>{formatDate(order.issued_to_faculty_on)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Signed order</div>
          <div>{order.file_uploaded_at ? "Uploaded" : "Not uploaded yet"}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {order.file_uploaded_at ? (
          <Button variant="ghost" size="sm" disabled={openMutation.isPending} onClick={() => openMutation.mutate()}>
            View signed order
          </Button>
        ) : null}
        {canWrite ? (
          <>
            <Button variant="outline" size="sm" asChild disabled={uploadMutation.isPending}>
              <label htmlFor={`permanent-order-${application.id}`} className="cursor-pointer">
                {order.file_uploaded_at ? "Replace signed order" : "Upload signed order"}
              </label>
            </Button>
            <input
              id={`permanent-order-${application.id}`}
              type="file"
              accept={JOINING_DOCUMENT_ACCEPT}
              className="sr-only"
              aria-label="Upload signed order"
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
