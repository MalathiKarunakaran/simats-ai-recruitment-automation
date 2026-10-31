import type { TalentPoolSourceTab } from "@/api/types";
import type { RegisterFilters } from "@/components/talentPool/TalentPoolRegister";

/**
 * The URL parameters that say WHAT a count means (2026-10-31). Every
 * clickable count on the Talent Pool page -- a tile, a breakdown row, a
 * month bar -- sets exactly one meaning, so clicking one REPLACES whichever
 * of these was set before. Stacking two counts' meanings would list people
 * matching neither number on screen.
 */
export const MEANING_PARAMS = [
  "status",
  "eligibility",
  "undecided",
  "source",
  "called_by",
  "applied_post",
  "month",
] as const;

export type MeaningParam = (typeof MEANING_PARAMS)[number];

/** The bucket the API folds everything below its top N into. It is not a
 * value anybody can filter on, so it is never a link. */
export const OTHERS_LABEL = "Others";

/** The register's filters live in the URL, so a clickable count is just a
 * link to this page with its filter already set, ending in `#register` so
 * the page scrolls the list into view.
 *
 * A count COMPOSES with the department filter rather than replacing the
 * whole query: having narrowed to ECE, clicking Selected should mean
 * "selected, in ECE" -- that is what drilling into a dashboard means. The
 * search box and the removed-rows switch are kept for the same reason. The
 * page offset is dropped: staying on page 4 of the old filter would show an
 * empty table and look like the new one found nothing. */
export function filterHref(
  tab: TalentPoolSourceTab,
  filters: Partial<Record<MeaningParam, string>>,
  currentParams?: URLSearchParams,
): string {
  const params = new URLSearchParams(currentParams ?? undefined);
  for (const key of MEANING_PARAMS) params.delete(key);
  params.delete("offset");
  if (tab === "NTS") params.set("tab", "nts");
  else params.delete("tab");
  for (const key of MEANING_PARAMS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return `/talent-pool${query ? `?${query}` : ""}#register`;
}

/** Every filter switched off, for the "Clear filters" button. */
export const CLEARED_FILTERS: RegisterFilters = {
  q: "",
  status: "",
  department: "",
  eligibility: "",
  source: "",
  calledBy: "",
  appliedPost: "",
  month: "",
  undecided: false,
  includeInactive: false,
  offset: 0,
};

function monthLabel(month: string): string {
  if (month === "undated") return "No readable date";
  const [year, mon] = month.split("-").map(Number);
  if (!year || !mon) return `Month: ${month}`;
  return `Month: ${new Date(year, mon - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}`;
}

/** What the register is currently showing, in words, one part per filter --
 * so a list reached by clicking a count always says which count it is. */
export function describeFilters(filters: RegisterFilters, teaching: boolean): string[] {
  const parts: string[] = [];
  if (filters.status) parts.push(filters.status);
  if (filters.undecided) parts.push("No decision yet");
  if (filters.eligibility) parts.push(`Eligibility: ${filters.eligibility}`);
  if (filters.department) parts.push(`Department: ${filters.department}`);
  if (filters.source) parts.push(`${teaching ? "Data source" : "Reference source"}: ${filters.source}`);
  if (filters.calledBy) parts.push(`Called by: ${filters.calledBy}`);
  if (filters.appliedPost) parts.push(`Applied post: ${filters.appliedPost}`);
  if (filters.month) parts.push(monthLabel(filters.month));
  if (filters.q) parts.push(`Search: \u201c${filters.q}\u201d`);
  if (filters.includeInactive) parts.push("Including removed rows");
  return parts;
}
