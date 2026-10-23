import { Award, CheckCircle2, Clock, HelpCircle, PhoneOff, Users, XCircle } from "lucide-react";

import { StatTile } from "@/components/dashboard/StatTile";
import type { TalentPoolSourceTab, TalentPoolSummary } from "@/api/types";

/**
 * The tile row (spec 1.2). Seven tiles per tab, different on each.
 *
 * Tiles that filter are LINKS, not click handlers. The spec asks for
 * "buttons with a visible focus state", but this page already keeps its
 * filters in the URL (so a link opens the same view), and `StatTile`'s own
 * contract deliberately offers `to` instead of `onClick` -- its docstring
 * records why: an anchor shows its destination on hover, is keyboard
 * reachable and can be opened in a new tab, "all of which a click handler on
 * a div silently loses". Using `to` therefore satisfies the intent of the
 * spec without giving up any of that.
 */

interface TalentPoolTilesProps {
  summary: TalentPoolSummary;
  tab: TalentPoolSourceTab;
  /** The page's current query string, so a tile composes with the filters
   * already applied instead of discarding them. */
  currentParams?: URLSearchParams;
  isLoading?: boolean;
}

/** The register's filters live in the URL, so a tile is just a link to this
 * page with those filters already set. The `#register` anchor is the scroll
 * target the register itself supplies (step D); until then the query
 * parameters still apply correctly and the anchor is simply inert.
 *
 * A tile COMPOSES with the department filter rather than replacing the whole
 * query: having narrowed to ECE, clicking Selected should mean "selected, in
 * ECE" -- that is what drilling into a dashboard means, and silently
 * dropping the department would make the number on screen disagree with the
 * tile that was clicked. Status and eligibility ARE replaced, because each
 * tile's row in spec 1.2 names every filter it sets, so leaving a previous
 * one in place would stack two tiles' meanings. */
function filterHref(
  tab: TalentPoolSourceTab,
  filters: { status?: string; eligibility?: string },
  currentParams?: URLSearchParams,
): string {
  const params = new URLSearchParams(currentParams ?? undefined);
  params.delete("status");
  params.delete("eligibility");
  if (tab === "NTS") params.set("tab", "nts");
  else params.delete("tab");
  if (filters.status) params.set("status", filters.status);
  if (filters.eligibility) params.set("eligibility", filters.eligibility);
  const query = params.toString();
  return `/talent-pool${query ? `?${query}` : ""}#register`;
}

/** Rounded percentage, or undefined when the denominator is zero -- "0% of
 * interviewed" when nobody has been interviewed is a false statement, so the
 * sub-line is omitted rather than shown as a zero. */
function percentOf(part: number, whole: number): number | undefined {
  if (whole <= 0) return undefined;
  return Math.round((part / whole) * 100);
}

export function TalentPoolTiles({ summary, tab, currentParams, isLoading = false }: TalentPoolTilesProps) {
  const status = (name: string) => summary.by_status[name] ?? 0;
  const eligibility = (name: string) => summary.by_eligibility[name] ?? 0;

  const selected = status("Selected");
  const waiting = status("Waiting List");
  const rejected = status("Rejected");
  const decided = selected + waiting + rejected;
  const decidedPct = percentOf(selected, decided);

  if (tab === "TEACHING_FINAL") {
    // The API returns what "Eligible" means rather than this file deciding,
    // so the tile's label and the backend's count cannot drift apart.
    const eligibleLabel = summary.eligible_definition.join(" / ") || "With Ph.D";
    const eligible = summary.eligible_definition.reduce((sum, v) => sum + eligibility(v), 0);
    const thesisStage = eligibility("Thesis / viva stage");

    return (
      <div data-testid="talent-pool-tiles" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <StatTile
          label="Total candidates"
          value={summary.total}
          subLine="in the Final sheet"
          icon={Users}
          iconColor="blue"
          accent="blue"
          isLoading={isLoading}
        />
        <StatTile
          label="Selected"
          value={selected}
          subLine={decidedPct === undefined ? undefined : `${decidedPct}% of interviewed`}
          icon={CheckCircle2}
          iconColor="green"
          accent="green"
          to={filterHref(tab, { status: "Selected" }, currentParams)}
          isLoading={isLoading}
        />
        <StatTile
          label="Waiting list"
          value={waiting}
          icon={Clock}
          iconColor="orange"
          accent="orange"
          to={filterHref(tab, { status: "Waiting List" }, currentParams)}
          isLoading={isLoading}
        />
        <StatTile
          label="Rejected"
          value={rejected}
          icon={XCircle}
          iconColor="red"
          accent="red"
          to={filterHref(tab, { status: "Rejected" }, currentParams)}
          isLoading={isLoading}
        />
        <StatTile
          label="Pending"
          value={status("Pending")}
          subLine="no decision recorded"
          icon={HelpCircle}
          iconColor="blue"
          to={filterHref(tab, { status: "Pending" }, currentParams)}
          isLoading={isLoading}
        />
        <StatTile
          label={`Eligible (${eligibleLabel})`}
          value={eligible}
          subLine={thesisStage > 0 ? `+${thesisStage} at thesis / viva stage` : undefined}
          icon={Award}
          iconColor="purple"
          to={filterHref(tab, { eligibility: summary.eligible_definition[0] }, currentParams)}
          isLoading={isLoading}
        />
        <StatTile
          label="Eligible, no decision"
          value={summary.eligible_pending}
          subLine={`${eligibleLabel}, not yet interviewed`}
          icon={Award}
          iconColor="orange"
          accent="gold"
          to={filterHref(tab, { eligibility: summary.eligible_definition[0], status: "Pending" }, currentParams)}
          isLoading={isLoading}
        />
      </div>
    );
  }

  // --- Non-teaching ---------------------------------------------------------
  const rnr = status("RNR");
  const onHold = status("On Hold");
  const interviewScheduled = status("Interview Scheduled");
  const followUp = rnr + onHold + interviewScheduled;

  return (
    <div data-testid="talent-pool-tiles" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      <StatTile
        label="Total candidates"
        value={summary.total}
        subLine="in the NTS sheet"
        icon={Users}
        iconColor="blue"
        accent="blue"
        isLoading={isLoading}
      />
      <StatTile
        label="Selected"
        value={selected}
        subLine={decidedPct === undefined ? undefined : `${decidedPct}% of decided`}
        icon={CheckCircle2}
        iconColor="green"
        accent="green"
        to={filterHref(tab, { status: "Selected" }, currentParams)}
        isLoading={isLoading}
      />
      <StatTile
        label="Waiting list"
        value={waiting}
        icon={Clock}
        iconColor="orange"
        accent="orange"
        to={filterHref(tab, { status: "Waiting List" }, currentParams)}
        isLoading={isLoading}
      />
      <StatTile
        label="Rejected"
        value={rejected}
        icon={XCircle}
        iconColor="red"
        accent="red"
        to={filterHref(tab, { status: "Rejected" }, currentParams)}
        isLoading={isLoading}
      />
      <StatTile
        label="In follow-up"
        value={followUp}
        subLine={`RNR ${rnr} \u00b7 On hold ${onHold}`}
        icon={Clock}
        iconColor="orange"
        isLoading={isLoading}
      />
      <StatTile
        label="Not interested"
        value={status("Not Interested")}
        icon={PhoneOff}
        iconColor="red"
        to={filterHref(tab, { status: "Not Interested" }, currentParams)}
        isLoading={isLoading}
      />
      <StatTile
        label="No outcome"
        value={status("No outcome")}
        subLine="date or note only"
        icon={HelpCircle}
        iconColor="blue"
        to={filterHref(tab, { status: "No outcome" }, currentParams)}
        isLoading={isLoading}
      />
    </div>
  );
}
