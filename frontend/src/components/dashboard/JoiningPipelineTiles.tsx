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

export const SHEET_CAMPUS_NOTE = "Talent Pool and sheet provisional orders have no campus, so the campus switcher does not narrow them.";
/** Under the Candidate outcomes card: the sheet part of a number ignores more
 * than the campus switcher, because sheet rows also carry no date, department,
 * designation or location. */
export const SHEET_FILTER_NOTE =
  "Sheet numbers are not narrowed by the campus switcher, the date range, or the department, designation and location filters.";

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
  // Teaching (Final tab) and Non-teaching (NTS tab) are never added together.
  const appWaiting = (category: string) => w?.applications_by_category?.[category] ?? 0;
  const waitlistedTiles = [
    { label: "Waitlisted (Teaching)", tab: "", category: "TEACHING", sheetCount: sheet ? (w?.talent_pool_final ?? null) : null, sheetName: "Final" },
    { label: "Waitlisted (Non-teaching)", tab: "&tab=nts", category: "NON_TEACHING", sheetCount: sheet ? (w?.talent_pool_nts ?? null) : null, sheetName: "NTS" },
    // The sheets have no Housekeeping tab: shown only when the app has someone waiting.
    ...(appWaiting("HOUSEKEEPING") > 0
      ? [{ label: "Waitlisted (Housekeeping)", tab: "", category: "HOUSEKEEPING", sheetCount: null, sheetName: "" }]
      : []),
  ];

  return (
    <section aria-labelledby="joining-pipeline-heading" data-testid="joining-pipeline-tiles">
      <h2 id="joining-pipeline-heading" className="mb-1.5 font-display text-sm font-semibold text-foreground">
        Joining pipeline
      </h2>
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-6">
        {waitlistedTiles.map(({ label, tab, category, sheetCount, sheetName }) => (
          <StatTile
            key={category}
            size="compact"
            label={label}
            value={value(w ? appWaiting(category) + (sheetCount ?? 0) : undefined)}
            isLoading={isLoading}
            accent="orange"
            tooltip={`${w && sheetCount !== null ? `${appWaiting(category) + sheetCount} = ${sheetCount} from the ${sheetName} sheet + ${appWaiting(category)} from the app. ` : ""}Applications in WAITLISTED for this category${sheet ? ` plus active Talent Pool entries marked "Waiting List" on the ${sheetName} tab. ${SHEET_CAMPUS_NOTE}` : "."}`}
            to={sheet ? `/talent-pool?status=Waiting%20List${tab}#register` : undefined}
          />
        ))}
        {sheet || isLoading ? (
          <StatTile
            size="compact"
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
          size="compact"
          label="Provisional orders issued (this month)"
          value={value(p?.total)}
          isLoading={isLoading}
          accent="green"
          tooltip={`${p && data ? `${monthLabel(data.month)}: ${sheet ? `${p.order_register} from the order register + ` : ""}${p.appointment_orders} from the app. ` : ""}${sheet ? "Order-register rows plus in-app" : "In-app"} appointment orders (issued) dated in the current calendar month, India time.`}
          to={sheet ? "/provisional-orders" : undefined}
        />
        <StatTile
          size="compact"
          label="Awaiting HOD review"
          value={value(h?.total)}
          isLoading={isLoading}
          accent="orange"
          tooltip={`${h ? `${sheet ? `${h.sheet_overdue} with probation overdue + ` : ""}${h.applications} from the app. ` : ""}Applications handed over to the HOD${sheet ? `, plus sheet provisional orders whose probation has ended with no outcome (the Provisional Orders page's "overdue" count). ${SHEET_CAMPUS_NOTE}` : "."}`}
          to={sheet ? `/provisional-orders?probation=overdue#${LIST_ID}` : undefined}
        />
        <StatTile
          size="compact"
          label="Awaiting permanent order"
          value={value(a?.total)}
          isLoading={isLoading}
          accent="blue"
          tooltip="Applications whose HOD review is complete and which are waiting for the permanent order."
          to="/onboarding?stage=HOD_REVIEW_COMPLETE"
        />
      </div>
    </section>
  );
}
