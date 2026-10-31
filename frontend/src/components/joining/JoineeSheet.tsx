import { useQuery } from "@tanstack/react-query";
import type * as React from "react";
import { Link } from "react-router-dom";

import { getJoinee, type JoineeRead } from "@/api/joiningRecords";
import {
  CATEGORY_LABELS,
  EMPLOYMENT_STATE_LABELS,
  ORDER_STATUS_LABELS,
  OUTCOME_LABELS,
  labelFor,
} from "@/components/joining/joiningLinks";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * One joiner, opened from a New Joinees row. Read-only like the Talent Pool
 * entry sheet it is modelled on: the sheet is the record. Shows the linked
 * Talent Pool entry and the provisional order when the sync found them, and
 * every stored sheet column (the allowlist -- mobile numbers are never
 * stored, so never shown).
 */

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 py-1 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value ?? <span className="text-muted-foreground">&mdash;</span>}</dd>
    </div>
  );
}

/** A parsed date, with the sheet's own text when it differs or did not parse. */
function dated(value: string | null, raw: string | null): React.ReactNode {
  if (!value && !raw) return null;
  if (value && (!raw || raw === value)) return value;
  return (
    <>
      {value ?? <span className="text-brand-warning">not a readable date</span>}
      {raw ? <span className="block text-[11px] text-muted-foreground">as typed: {raw}</span> : null}
    </>
  );
}

function rawValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function JoineeSheet({ joinee, onClose }: { joinee: JoineeRead | null; onClose: () => void }) {
  const detailQuery = useQuery({
    queryKey: ["joining-records", "joinee", joinee?.id],
    queryFn: () => getJoinee(joinee!.id),
    enabled: Boolean(joinee),
  });
  const detail = detailQuery.data;
  const shown = detail ?? joinee;
  const order = detail?.provisional_order;
  const pool = detail?.talent_pool_entry;

  return (
    <Sheet open={Boolean(joinee)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent>
        {shown ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                {shown.full_name ?? "(no name)"}
                {!shown.is_active ? <Badge variant="warning">Removed from sheet</Badge> : null}
              </SheetTitle>
            </SheetHeader>
            <SheetBody>
              <dl className="divide-y divide-border">
                <Field label="BIO ID" value={shown.bio_id} />
                {shown.new_bio_id ? <Field label="New BIO ID" value={shown.new_bio_id} /> : null}
                <Field label="Staff ID" value={shown.staff_id} />
                <Field
                  label="Category"
                  value={
                    <>
                      {labelFor(CATEGORY_LABELS, shown.category)}
                      {shown.employee_type_raw ? (
                        <span className="block text-[11px] text-muted-foreground">as typed: {shown.employee_type_raw}</span>
                      ) : null}
                    </>
                  }
                />
                <Field label="Campus" value={shown.campus_code ?? shown.college_raw} />
                <Field label="Designation" value={shown.designation} />
                <Field label="Department" value={shown.department_raw} />
                {shown.dept_new_raw ? <Field label="New department" value={shown.dept_new_raw} /> : null}
                <Field label="Reporting to" value={shown.reporting_to} />
                <Field label="Joined on" value={dated(shown.joined_on, shown.joined_on_raw)} />
                <Field
                  label="Status"
                  value={
                    <>
                      {labelFor(EMPLOYMENT_STATE_LABELS, shown.employment_state)}
                      {shown.status_raw && shown.status_raw !== shown.employment_state ? (
                        <span className="block text-[11px] text-muted-foreground">as typed: {shown.status_raw}</span>
                      ) : null}
                    </>
                  }
                />
                {detail ? (
                  <>
                    <Field label="Interview" value={dated(detail.interview_on, detail.interview_on_raw)} />
                    <Field label="Prov. order given" value={dated(detail.prov_order_given_on, detail.prov_order_given_on_raw)} />
                    <Field label="Sent" value={dated(detail.send_on, detail.send_on_raw)} />
                    <Field label="Received" value={dated(detail.received_on, detail.received_on_raw)} />
                    <Field label="Relieving order" value={detail.relieving_order_submitted} />
                    <Field label="Originals" value={detail.original_submitted} />
                    <Field label="Appointment order" value={detail.appointment_order} />
                  </>
                ) : null}
                <Field label="Sheet row" value={shown.sheet_row_number ? `Row ${shown.sheet_row_number}` : null} />
              </dl>

              <section className="mt-4">
                <h3 className="mb-1 text-xs font-semibold">Talent Pool</h3>
                {pool ? (
                  <p className="text-xs">
                    <Link
                      to={`/talent-pool${pool.source_tab === "NTS" ? "?tab=nts" : ""}`}
                      className="font-medium text-brand-primary underline"
                    >
                      {pool.full_name}
                    </Link>{" "}
                    &middot; {pool.source_tab === "NTS" ? "Non-teaching" : "Teaching"} &middot; {pool.sheet_status}
                    {!pool.is_active ? " · removed from sheet" : ""}
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    {detailQuery.isLoading ? "Loading…" : "Not linked to a Talent Pool entry."}
                  </p>
                )}
              </section>

              <section className="mt-4">
                <h3 className="mb-1 text-xs font-semibold">Provisional order</h3>
                {order ? (
                  <dl className="divide-y divide-border">
                    <Field label="Order status" value={labelFor(ORDER_STATUS_LABELS, order.items.order_status.effective as string | null)} />
                    <Field label="Order date" value={dated(order.order_on, order.order_on_raw)} />
                    <Field label="Probation ends" value={dated(order.probation_end_on, order.probation_end_on_raw)} />
                    <Field label="Outcome" value={labelFor(OUTCOME_LABELS, order.items.outcome.effective as string | null)} />
                    <Field label="Room" value={order.items.room_allotted.effective as string | null} />
                  </dl>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    {detailQuery.isLoading ? "Loading…" : "No provisional order linked."}
                  </p>
                )}
              </section>

              <section className="mt-4">
                <h3 className="mb-1 text-xs font-semibold">All stored columns</h3>
                {detail && Object.keys(detail.raw).length > 0 ? (
                  <dl className="divide-y divide-border">
                    {Object.entries(detail.raw).map(([key, value]) => (
                      <div key={key} className="grid grid-cols-[9rem_1fr] gap-2 py-1 text-[11px]">
                        <dt className="break-words text-muted-foreground">{key}</dt>
                        <dd className="min-w-0 break-words">{rawValue(value)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    {detailQuery.isLoading ? "Loading the sheet row…" : "No sheet columns were stored for this row."}
                  </p>
                )}
              </section>
            </SheetBody>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
