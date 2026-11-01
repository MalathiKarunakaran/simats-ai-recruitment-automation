import type { DashboardPipelineExtras } from "@/api/dashboard";
import { LIST_ID } from "@/components/joining/joiningLinks";
import { StatTile } from "@/components/dashboard/StatTile";

/** Pipeline-completion brief, "Dashboard additions": five tiles for the
 * stages after selection. Each number is the in-app source plus the synced
 * sheet source (production has no Applications yet), broken down in the
 * sub-line. Data: GET /dashboard/pipeline-extras.
 *
 * When the caller's role cannot read the sheet sources (`sheet_visible`
 * false) the sheet parts arrive as null: the sub-lines then show the in-app
 * count only, the Sent to University tile is not drawn, and tiles do not
 * link to pages that role cannot open. */

const SHEET_CAMPUS_NOTE = "Talent Pool and sheet provisional orders have no campus, so the campus switcher does not narrow them.";

function monthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  if (!year || !m) return month;
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function JoiningPipelineTiles({ data, isLoading }: { data: DashboardPipelineExtras | undefined; isLoading: boolean }) {
  const sheet = data?.sheet_visible ?? false;
  const value = (n: number | undefined) => (isLoading ? undefined : n);
  const w = data?.waitlisted;
  const s = data?.sent_to_university;
  const p = data?.provisional_orders_this_month;
  const h = data?.awaiting_hod_review;
  const a = data?.awaiting_permanent_order;

  return (
    <section aria-labelledby="joining-pipeline-heading" data-testid="joining-pipeline-tiles">
      <h2 id="joining-pipeline-heading" className="mb-2 font-display text-sm font-semibold text-foreground">
        Joining pipeline
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="Waitlisted"
          value={value(w?.total)}
          isLoading={isLoading}
          accent="orange"
          subLine={w ? (sheet ? `Final ${w.talent_pool_final} · NTS ${w.talent_pool_nts} · app ${w.applications}` : `app ${w.applications}`) : undefined}
          tooltip={`Applications in WAITLISTED${sheet ? ` plus active Talent Pool entries marked "Waiting List" on both tabs. ${SHEET_CAMPUS_NOTE}` : "."}`}
          to={sheet ? "/talent-pool?status=Waiting%20List#register" : undefined}
        />
        {sheet || isLoading ? (
          <StatTile
            label="Sent to University (pending)"
            value={value(s?.total)}
            isLoading={isLoading}
            accent="blue"
            subLine={s && s.members !== null ? `${s.members} people · ${s.batches} batches` : undefined}
            tooltip="People in selection batches still awaiting University approval (status Sent to University)."
            to="/selection-batches?status=SENT_TO_UNIVERSITY"
          />
        ) : null}
        <StatTile
          label="Provisional orders issued (this month)"
          value={value(p?.total)}
          isLoading={isLoading}
          accent="green"
          subLine={
            p && data
              ? `${monthLabel(data.month)} · ${sheet ? `register ${p.order_register} · ` : ""}app ${p.appointment_orders}`
              : undefined
          }
          tooltip={`${sheet ? "Order-register rows plus in-app" : "In-app"} appointment orders (issued) dated in the current calendar month, India time.`}
          to={sheet ? "/provisional-orders" : undefined}
        />
        <StatTile
          label="Awaiting HOD review"
          value={value(h?.total)}
          isLoading={isLoading}
          accent="orange"
          subLine={h ? (sheet ? `probation overdue ${h.sheet_overdue} · app ${h.applications}` : `app ${h.applications}`) : undefined}
          tooltip={`Applications handed over to the HOD${sheet ? `, plus sheet provisional orders whose probation has ended with no outcome (the Provisional Orders page's "overdue" count). ${SHEET_CAMPUS_NOTE}` : "."}`}
          to={sheet ? `/provisional-orders?probation=overdue#${LIST_ID}` : undefined}
        />
        <StatTile
          label="Awaiting permanent order"
          value={value(a?.total)}
          isLoading={isLoading}
          accent="blue"
          subLine={a ? `app ${a.applications}` : undefined}
          tooltip="Applications whose HOD review is complete and which are waiting for the permanent order."
          to="/onboarding?stage=HOD_REVIEW_COMPLETE"
        />
      </div>
    </section>
  );
}
