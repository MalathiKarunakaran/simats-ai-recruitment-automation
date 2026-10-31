import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type * as React from "react";

import { ApiError } from "@/api/client";
import {
  markOrder,
  type MarkField,
  type MarkValue,
  type MarkedItem,
  type OrderMarksUpdate,
  type OrderRead,
} from "@/api/joiningRecords";
import {
  CHECKLIST_ITEMS,
  ORDER_STATUS_LABELS,
  OUTCOME_LABELS,
  checklistText,
  labelFor,
} from "@/components/joining/joiningLinks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * One provisional order, opened from a Provisional Orders row
 * (docs/specs/joining-screens.md, Step A2). Shows every checklist item with
 * its EFFECTIVE value (the app mark if one is set, else the sheet's) and a
 * "marked in app by …" note where the app mark applies. For the three
 * marker roles every item is editable; "Use sheet value" clears the app
 * mark. The sheet itself is never written.
 */

const OUTCOME_CHOICES = Object.keys(OUTCOME_LABELS).filter((k) => k !== "none");
const USE_SHEET = "__sheet__";

function formatDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function SourceNote({ item, hasSheet = true }: { item: MarkedItem; hasSheet?: boolean }) {
  if (item.source === "app") {
    const when = item.marked_at ? new Date(item.marked_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null;
    return (
      <span className="block text-[11px] text-brand-info">
        Marked in app by {item.marked_by ?? "someone"}
        {when ? `, ${when}` : ""}
        {hasSheet ? ` · sheet: ${item.sheet_raw ?? "blank"}` : ""}
      </span>
    );
  }
  if (!hasSheet) return <span className="block text-[11px] text-muted-foreground">Not marked yet</span>;
  return <span className="block text-[11px] text-muted-foreground">From the sheet</span>;
}

function Row({ label, value, note }: { label: string; value: React.ReactNode; note: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 py-1.5 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">
        {value ?? <span className="text-muted-foreground">Not recorded</span>}
        {note}
      </dd>
    </div>
  );
}

/** A radio group whose "clear" choice (null) means "use the sheet value". */
function Choice({
  name,
  legend,
  value,
  options,
  onChange,
}: {
  name: string;
  legend: string;
  value: MarkValue;
  options: { value: MarkValue; label: string }[];
  onChange: (value: MarkValue) => void;
}) {
  return (
    <fieldset className="py-1.5">
      <legend className="mb-1 text-xs font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {options.map((option) => (
          <label key={String(option.value)} className="flex items-center gap-1.5 text-xs">
            <input
              type="radio"
              name={name}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function sheetWord(item: MarkedItem, done: string, notDone: string): string {
  if (item.sheet === true) return done;
  if (item.sheet === false) return notDone;
  return item.sheet_raw ? `“${item.sheet_raw}”` : "blank";
}

function ReadOnly({ order }: { order: OrderRead }) {
  const it = order.items;
  const yesDate = (flag: MarkField, date: MarkField, yes: string) =>
    it[flag].effective === true ? `${yes}${it[date].effective ? `, ${formatDay(String(it[date].effective))}` : ""}` : it[flag].effective === false ? "No" : null;
  return (
    <dl className="divide-y divide-border">
      {CHECKLIST_ITEMS.map(({ field, label, done, notDone }) => (
        <Row key={field} label={label} value={checklistText(it[field], done, notDone)} note={<SourceNote item={it[field]} />} />
      ))}
      <Row label="Room allotted" value={it.room_allotted.effective as string | null} note={<SourceNote item={it.room_allotted} />} />
      <Row
        label="Provision order"
        value={it.order_status.effective ? labelFor(ORDER_STATUS_LABELS, it.order_status.effective as string) : null}
        note={<SourceNote item={it.order_status} />}
      />
      <Row
        label="Probation outcome"
        value={it.outcome.effective ? labelFor(OUTCOME_LABELS, it.outcome.effective as string) : it.outcome.sheet_raw}
        note={<SourceNote item={it.outcome} />}
      />
      <Row
        label="Registrar's final order"
        value={yesDate("registrar_order_issued", "registrar_order_date", "Issued")}
        note={<SourceNote item={it.registrar_order_issued} hasSheet={false} />}
      />
      <Row
        label="Orientation"
        value={yesDate("orientation_conducted", "orientation_date", "Conducted")}
        note={<SourceNote item={it.orientation_conducted} hasSheet={false} />}
      />
    </dl>
  );
}

const ALL_FIELDS: MarkField[] = [
  "id_card_done",
  "food_app_done",
  "arms_done",
  "app_360_done",
  "adfa_file_done",
  "room_allotted",
  "order_status",
  "outcome",
  "registrar_order_issued",
  "registrar_order_date",
  "orientation_conducted",
  "orientation_date",
];

function appValues(order: OrderRead): Record<MarkField, MarkValue> {
  return Object.fromEntries(ALL_FIELDS.map((f) => [f, order.items[f].app])) as Record<MarkField, MarkValue>;
}

function MarksForm({ order, onSaved }: { order: OrderRead; onSaved: (order: OrderRead) => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => appValues(order));
  const [error, setError] = useState<string | null>(null);
  const saved = appValues(order);
  const changes: OrderMarksUpdate = {};
  for (const f of ALL_FIELDS) {
    const value = f === "room_allotted" ? (String(draft[f] ?? "").trim() || null) : draft[f];
    if (value !== saved[f]) changes[f] = value;
  }
  const changed = Object.keys(changes).length > 0;
  const set = (field: MarkField, value: MarkValue) => setDraft((d) => ({ ...d, [field]: value }));
  // A date belongs to its yes: turning the yes off clears the date too.
  const setFlag = (flag: MarkField, date: MarkField, value: MarkValue) =>
    setDraft((d) => ({ ...d, [flag]: value, [date]: value === true ? d[date] : null }));

  const mutation = useMutation({
    mutationFn: () => markOrder(order.id, changes),
    onSuccess: (updated) => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["joining-records", "orders"] });
      onSaved(updated);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save the marks"),
  });

  const it = order.items;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (changed) mutation.mutate();
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <SheetBody>
        <div className="divide-y divide-border">
          {CHECKLIST_ITEMS.map(({ field, label, done, notDone }) => (
            <div key={field}>
              <Choice
                name={`${order.id}-${field}`}
                legend={label}
                value={draft[field]}
                onChange={(v) => set(field, v)}
                options={[
                  { value: true, label: done },
                  { value: false, label: notDone },
                  { value: null, label: `Use sheet value (${sheetWord(it[field], done, notDone)})` },
                ]}
              />
              <SourceNote item={it[field]} />
            </div>
          ))}
          <div className="py-1.5">
            <label htmlFor={`${order.id}-room`} className="mb-1 block text-xs font-medium">
              Room allotted
            </label>
            <Input
              id={`${order.id}-room`}
              value={String(draft.room_allotted ?? "")}
              maxLength={255}
              placeholder={it.room_allotted.sheet_raw ? `Sheet: ${it.room_allotted.sheet_raw}` : "Blank uses the sheet value"}
              onChange={(e) => set("room_allotted", e.target.value)}
              className="h-8 text-xs"
            />
            <SourceNote item={it.room_allotted} />
          </div>
          <div>
            <Choice
              name={`${order.id}-order_status`}
              legend="Provision order"
              value={draft.order_status}
              onChange={(v) => set("order_status", v)}
              options={[
                { value: "ISSUED", label: "Issued" },
                { value: "PENDING", label: "Pending" },
                { value: null, label: `Use sheet value (${labelFor(ORDER_STATUS_LABELS, it.order_status.sheet as string | null)})` },
              ]}
            />
            <SourceNote item={it.order_status} />
          </div>
          <div className="py-1.5">
            <p className="mb-1 text-xs font-medium" id={`${order.id}-outcome-label`}>
              Probation outcome
            </p>
            <Select value={(draft.outcome as string | null) ?? USE_SHEET} onValueChange={(v) => set("outcome", v === USE_SHEET ? null : v)}>
              <SelectTrigger className="h-8 text-xs" aria-labelledby={`${order.id}-outcome-label`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={USE_SHEET}>
                  Use sheet value ({it.outcome.sheet ? labelFor(OUTCOME_LABELS, it.outcome.sheet as string) : it.outcome.sheet_raw ?? "no outcome"})
                </SelectItem>
                {OUTCOME_CHOICES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {OUTCOME_LABELS[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SourceNote item={it.outcome} />
          </div>
          {(
            [
              ["registrar_order_issued", "registrar_order_date", "Final appointment order from the Registrar's office", "Issued"],
              ["orientation_conducted", "orientation_date", "Orientation conducted", "Conducted"],
            ] as const
          ).map(([flag, date, legend, yes]) => (
            <div key={flag}>
              <Choice
                name={`${order.id}-${flag}`}
                legend={legend}
                value={draft[flag]}
                onChange={(v) => setFlag(flag, date, v)}
                options={[
                  { value: true, label: yes },
                  { value: false, label: "No" },
                  { value: null, label: "Not marked" },
                ]}
              />
              {draft[flag] === true ? (
                <label className="flex items-center gap-2 pb-1 text-xs">
                  Date
                  <Input
                    type="date"
                    aria-label={`${legend} date`}
                    value={String(draft[date] ?? "")}
                    onChange={(e) => set(date, e.target.value || null)}
                    className="h-8 w-40 text-xs"
                  />
                </label>
              ) : null}
              <SourceNote item={it[flag]} hasSheet={false} />
            </div>
          ))}
        </div>
        {error ? <p className="text-xs text-brand-danger">{error}</p> : null}
      </SheetBody>
      <SheetFooter>
        <Button type="submit" size="sm" disabled={!changed || mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save"}
        </Button>
      </SheetFooter>
    </form>
  );
}

export function OrderSheet({
  order,
  canMark,
  onClose,
  onSaved,
}: {
  order: OrderRead | null;
  canMark: boolean;
  onClose: () => void;
  onSaved: (order: OrderRead) => void;
}) {
  return (
    <Sheet open={Boolean(order)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent aria-describedby={undefined}>
        {order ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                {order.full_name ?? "(no name)"}
                {!order.is_active ? <Badge variant="warning">Removed from sheet</Badge> : null}
              </SheetTitle>
              <p className="text-[11px] text-muted-foreground">
                {[order.bio_id && `BIO ${order.bio_id}`, order.emp_id && `Emp ${order.emp_id}`, order.order_on && `Order ${order.order_on}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {canMark ? (
                <p className="text-[11px] text-muted-foreground">
                  Marks are kept in the app and win over the sheet; the sheet is not changed.
                </p>
              ) : null}
            </SheetHeader>
            {canMark ? (
              <MarksForm key={order.id} order={order} onSaved={onSaved} />
            ) : (
              <SheetBody>
                <ReadOnly order={order} />
              </SheetBody>
            )}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
