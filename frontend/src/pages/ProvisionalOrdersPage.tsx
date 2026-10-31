import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FileCheck } from "lucide-react";
import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { getOrderSummary, listOrders, type OrderRead, type ProbationFilter } from "@/api/joiningRecords";
import type { UserRole } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { StatTile } from "@/components/dashboard/StatTile";
import { ActiveFiltersLine } from "@/components/joining/ActiveFiltersLine";
import {
  CHECKLIST_ITEMS,
  LIST_ID,
  ORDER_STATUS_LABELS,
  OUTCOME_LABELS,
  PROBATION_LABELS,
  checklistText,
  countHref,
  labelFor,
  syncLine,
  withParams,
} from "@/components/joining/joiningLinks";
import { OrderSheet } from "@/components/joining/OrderSheet";
import { SearchBox } from "@/components/joining/SearchBox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { Switch } from "@/components/ui/switch";
import { useScrollToHash } from "@/hooks/useScrollToHash";

/**
 * Provisional Orders (docs/specs/joining-screens.md, screen 2 + Step A2).
 * Over the synced Pro App Order sheet, with checklist marks the three
 * marker roles keep in the app (the app mark wins; the sheet is never
 * written). Every value, tile and filter here is the EFFECTIVE one, and
 * every tile opens the list below filtered to exactly the rows it counted.
 * "Ending in 30 days" and "overdue" are relative to the server's today,
 * which the summary returns and the page states. A row opens OrderSheet.
 */

const PATH = "/provisional-orders";
const PAGE_SIZE = 25;
const MEANING = ["order_status", "outcome", "probation", "linked", "registrar_order", "orientation"] as const;
const PROBATION_VALUES: ProbationFilter[] = ["due30", "overdue", "ended"];
// Mirrors joining_records.py's _MARKERS (UX only; the backend re-checks).
const MARKER_ROLES: readonly UserRole[] = ["SUPER_ADMIN", "HR_ADMIN", "RECRUITMENT_COORDINATOR"];

function boolParam(value: string): boolean | undefined {
  return value === "true" ? true : value === "false" ? false : undefined;
}

const SHORT_LABELS: Record<string, string> = {
  id_card_done: "ID card",
  food_app_done: "Food app",
  arms_done: "Arms",
  app_360_done: "360 app",
  adfa_file_done: "ADFA file",
};

function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** Days from `today` to `end`, both ISO dates (no time zone involved). */
function daysUntil(end: string, today: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

function ProbationCell({ order, today }: { order: OrderRead; today: string | undefined }) {
  if (!order.probation_end_on) {
    return <>{order.probation_end_on_raw ?? "—"}</>;
  }
  const days = today ? daysUntil(order.probation_end_on, today) : null;
  return (
    <>
      <span className="tabular-nums">{order.probation_end_on}</span>
      {days !== null && days < 0 && !order.items.outcome.effective ? (
        <Badge variant="destructive" className="ml-1.5">Overdue</Badge>
      ) : days !== null && days >= 0 && days <= 30 ? (
        <Badge variant="warning" className="ml-1.5">{days === 0 ? "Today" : `In ${days}d`}</Badge>
      ) : null}
    </>
  );
}

export function ProvisionalOrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const get = (key: string) => searchParams.get(key) ?? "";
  const includeInactive = get("include_inactive") === "true";
  const probationParam = get("probation");
  const filters = {
    q: get("q"),
    orderStatus: get("order_status"),
    outcome: get("outcome"),
    probation: PROBATION_VALUES.includes(probationParam as ProbationFilter) ? (probationParam as ProbationFilter) : undefined,
    linked: boolParam(get("linked")),
    registrarOrder: boolParam(get("registrar_order")),
    orientation: boolParam(get("orientation")),
    offset: Math.max(0, Number(get("offset")) || 0),
  };

  const summaryQuery = useQuery({
    queryKey: ["joining-records", "orders", "summary", includeInactive],
    queryFn: () => getOrderSummary(includeInactive),
  });
  const listQuery = useQuery({
    queryKey: ["joining-records", "orders", "list", searchParams.toString()],
    queryFn: () =>
      listOrders({
        q: filters.q || undefined,
        order_status: filters.orderStatus || undefined,
        outcome: filters.outcome || undefined,
        probation: filters.probation,
        linked: filters.linked,
        registrar_order: filters.registrarOrder,
        orientation: filters.orientation,
        include_inactive: includeInactive || undefined,
        limit: PAGE_SIZE,
        offset: filters.offset,
      }),
    placeholderData: keepPreviousData,
  });
  const summary = summaryQuery.data;
  const data = listQuery.data;
  const { user } = useAuth();
  const canMark = Boolean(user && MARKER_ROLES.includes(user.role));
  const [openOrder, setOpenOrder] = useState<OrderRead | null>(null);
  useScrollToHash(LIST_ID, Boolean(summary) && (data !== undefined || listQuery.isError));

  const update = useCallback(
    (next: Record<string, string | boolean | number | undefined>) =>
      setSearchParams(withParams(searchParams, next), { replace: true }),
    [searchParams, setSearchParams],
  );
  const changeSearch = useCallback((q: string) => update({ q, offset: 0 }), [update]);
  const href = (set: Partial<Record<(typeof MEANING)[number], string>>) => countHref(PATH, MEANING, set, searchParams);

  const parts: string[] = [];
  if (filters.orderStatus) parts.push(`Order: ${labelFor(ORDER_STATUS_LABELS, filters.orderStatus)}`);
  if (filters.outcome) parts.push(`Outcome: ${labelFor(OUTCOME_LABELS, filters.outcome)}`);
  if (filters.probation) parts.push(PROBATION_LABELS[filters.probation]);
  if (filters.linked === false) parts.push("Not linked to a joiner");
  if (filters.linked === true) parts.push("Linked to a joiner");
  if (filters.registrarOrder === true) parts.push("Registrar order issued");
  if (filters.registrarOrder === false) parts.push("Registrar order not yet issued");
  if (filters.orientation === true) parts.push("Orientation conducted");
  if (filters.orientation === false) parts.push("Orientation not yet conducted");
  if (filters.q) parts.push(`Search: “${filters.q}”`);
  if (includeInactive) parts.push("Including removed rows");

  const status = (key: string) => summary?.by_order_status[key] ?? 0;
  const outcome = (key: string) => summary?.by_outcome[key] ?? 0;
  const loading = summaryQuery.isLoading;

  return (
    <div className="space-y-4 px-4 py-4 sm:px-6">
      <header className="min-w-0">
        <h1 className="flex items-center gap-2 font-display text-xl font-bold">
          <FileCheck className="h-5 w-5 text-brand-primary" aria-hidden="true" />
          Provisional Orders
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {summary ? `${syncLine(summary.last_sync_at)} · probation dates measured from ${formatDay(summary.today)}` : "Loading…"}
        </p>
      </header>

      {summaryQuery.isError ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <p className="text-xs text-brand-danger">
              {summaryQuery.error instanceof Error ? summaryQuery.error.message : "Could not load the orders summary"}
            </p>
            <Button variant="outline" size="sm" onClick={() => void summaryQuery.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : summary && summary.total === 0 && !includeInactive ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium">No provisional orders synced yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              This page fills from the Pro App Order sheet once its sync has run (Administration &rarr; Data Sync Status).
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div data-testid="order-tiles" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Issued" value={status("ISSUED")} subLine={summary ? `of ${summary.total} orders` : undefined} accent="blue" to={href({ order_status: "ISSUED" })} isLoading={loading} />
            <StatTile label="Pending" value={status("PENDING")} subLine="order not yet issued" accent="orange" to={href({ order_status: "PENDING" })} isLoading={loading} />
            <StatTile label="Permanent order received" value={outcome("PERMANENT_ORDER_RECEIVED")} accent="green" to={href({ outcome: "PERMANENT_ORDER_RECEIVED" })} isLoading={loading} />
            <StatTile label="Probation extended" value={outcome("PROBATION_EXTENDED")} accent="orange" to={href({ outcome: "PROBATION_EXTENDED" })} isLoading={loading} />
            <StatTile label="Not recommended" value={outcome("NOT_RECOMMENDED")} accent="red" to={href({ outcome: "NOT_RECOMMENDED" })} isLoading={loading} />
            <StatTile label="Probation ending in 30 days" value={summary?.probation_due30} subLine="any outcome" accent="orange" to={href({ probation: "due30" })} isLoading={loading} />
            <StatTile label="Overdue — no outcome" value={summary?.probation_overdue} subLine="probation ended, nothing recorded" accent="red" to={href({ probation: "overdue" })} isLoading={loading} />
            <StatTile label="Not linked to a joiner" value={summary?.unlinked} subLine="no New Joinees row with this BIO ID" to={href({ linked: "false" })} isLoading={loading} />
            <StatTile label="Registrar order issued" value={summary?.registrar_order_issued} subLine="final appointment order, marked in app" accent="green" to={href({ registrar_order: "true" })} isLoading={loading} />
            <StatTile label="Registrar order not yet" value={summary?.registrar_order_pending} to={href({ registrar_order: "false" })} isLoading={loading} />
            <StatTile label="Orientation conducted" value={summary?.orientation_conducted} subLine="marked in app" accent="green" to={href({ orientation: "true" })} isLoading={loading} />
            <StatTile label="Orientation not yet" value={summary?.orientation_pending} to={href({ orientation: "false" })} isLoading={loading} />
            <StatTile label="All orders" value={summary?.total} to={href({})} isLoading={loading} />
          </div>

          <section id={LIST_ID} className="scroll-mt-4 space-y-3">
            <h2 className="text-sm font-semibold">Orders</h2>
            <div className="flex flex-wrap items-center gap-2">
              <SearchBox value={filters.q} onChange={changeSearch} placeholder="Search name, BIO ID, employee ID, room" label="Search orders" />
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={includeInactive}
                  onCheckedChange={(checked) => update({ include_inactive: checked, offset: 0 })}
                  aria-label="Show removed rows"
                />
                Show removed rows
              </label>
            </div>

            <ActiveFiltersLine
              parts={parts}
              total={data?.total}
              noun={["order", "orders"]}
              onClear={() => setSearchParams(new URLSearchParams(), { replace: true })}
            />

            {listQuery.isError ? (
              <p className="text-xs text-brand-danger">
                {listQuery.error instanceof Error ? listQuery.error.message : "Could not load the orders"}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table data-testid="order-table" className="w-full min-w-[56rem] text-xs">
                  <thead className="bg-card">
                    <tr className="border-b border-border text-left">
                      <th scope="col" className="px-2 py-1.5 font-medium">Name</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Order</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Probation ends</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Checklist</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Room</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data && data.items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">
                          No orders match these filters.
                        </td>
                      </tr>
                    ) : null}
                    {data?.items.map((o) => (
                      <tr
                        key={o.id}
                        tabIndex={0}
                        onClick={() => setOpenOrder(o)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setOpenOrder(o);
                          }
                        }}
                        className="cursor-pointer border-b border-border align-top last:border-0 hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
                      >
                        <td className="px-2 py-1.5">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{o.full_name ?? "(no name)"}</span>
                            {!o.is_active ? <Badge variant="warning">Removed from sheet</Badge> : null}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {[o.bio_id && `BIO ${o.bio_id}`, o.emp_id && `Emp ${o.emp_id}`].filter(Boolean).join(" · ") || "—"}
                            {o.sheet_joinee_id ? "" : " · no joiner row"}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="tabular-nums">{o.order_on ?? o.order_on_raw ?? "—"}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {labelFor(ORDER_STATUS_LABELS, o.items.order_status.effective as string | null)}
                            {o.items.order_status.source === "app" ? " (app)" : ""}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          <ProbationCell order={o} today={summary?.today} />
                        </td>
                        <td className="px-2 py-1.5">
                          <ul className="flex flex-wrap gap-1">
                            {CHECKLIST_ITEMS.map(({ field, done, notDone }) => {
                              const item = o.items[field];
                              const label = SHORT_LABELS[field];
                              const value = checklistText(item, done, notDone);
                              const app = item.source === "app" ? " (app)" : "";
                              return (
                                <li
                                  key={field}
                                  title={value ? `${label}: ${value}${app}` : `${label}: not recorded`}
                                  className={
                                    item.effective === true
                                      ? "rounded border border-brand-success/40 bg-brand-success/10 px-1.5 py-0.5 text-[10px]"
                                      : "rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                  }
                                >
                                  {label}
                                  {value ? `: ${value}` : ""}
                                  {app ? <span className="text-brand-info">{app}</span> : null}
                                </li>
                              );
                            })}
                          </ul>
                        </td>
                        <td className="px-2 py-1.5">{(o.items.room_allotted.effective as string | null) ?? "—"}</td>
                        <td className="px-2 py-1.5">
                          {o.items.outcome.effective ? (
                            <Badge
                              variant={
                                o.items.outcome.effective === "PERMANENT_ORDER_RECEIVED"
                                  ? "success"
                                  : o.items.outcome.effective === "NOT_RECOMMENDED"
                                    ? "destructive"
                                    : "warning"
                              }
                            >
                              {labelFor(OUTCOME_LABELS, o.items.outcome.effective as string)}
                              {o.items.outcome.source === "app" ? " (app)" : ""}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">{o.outcome_raw ?? "—"}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {data && data.total > PAGE_SIZE ? (
              <Pagination
                total={data.total}
                limit={PAGE_SIZE}
                offset={filters.offset}
                onOffsetChange={(offset) => update({ offset })}
                itemLabel="orders"
              />
            ) : null}
          </section>
        </>
      )}
      <OrderSheet order={openOrder} canMark={canMark} onClose={() => setOpenOrder(null)} onSaved={setOpenOrder} />
    </div>
  );
}
