import { NONE_KEY } from "@/api/joiningRecords";

/**
 * Shared plumbing for the three Joining pages (docs/specs/joining-screens.md),
 * the same pattern as the Talent Pool's filterHref.ts: every filter is URL
 * state, a clickable count is a plain link to the page with its filter set,
 * ending in `#list` so the page scrolls the list into view.
 *
 * Unlike the Talent Pool, a count here REPLACES every meaning filter and the
 * search box: the number on a tile is computed without a search, so carrying
 * a search across would open a list shorter than the number clicked. The
 * "show removed rows" switch is kept, because the summaries honour it too.
 */
export const LIST_ID = "list";

export function countHref(
  pathname: string,
  meaningParams: readonly string[],
  filters: Record<string, string | undefined>,
  currentParams?: URLSearchParams,
): string {
  const params = new URLSearchParams();
  if (currentParams?.get("include_inactive") === "true") params.set("include_inactive", "true");
  for (const key of meaningParams) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  const search = params.toString();
  return `${pathname}${search ? `?${search}` : ""}#${LIST_ID}`;
}

/** Writes `next` into a copy of `current`: "" / false / 0 remove the key, so
 * a shared link carries only what was actually chosen. */
export function withParams(
  current: URLSearchParams,
  next: Record<string, string | boolean | number | undefined>,
): URLSearchParams {
  const params = new URLSearchParams(current);
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue;
    if (value === "" || value === false || value === 0) params.delete(key);
    else params.set(key, String(value));
  }
  return params;
}

export const CATEGORY_LABELS: Record<string, string> = {
  TEACHING: "Teaching",
  NON_TEACHING: "Non-teaching",
  HOUSEKEEPING: "Housekeeping",
  [NONE_KEY]: "No category",
};

export const EMPLOYMENT_STATE_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  LEFT: "Left",
  REJOINED: "Rejoined",
  [NONE_KEY]: "No status",
};

export const ORDER_STATUS_LABELS: Record<string, string> = {
  ISSUED: "Issued",
  PENDING: "Pending",
  [NONE_KEY]: "No order status",
};

export const OUTCOME_LABELS: Record<string, string> = {
  PERMANENT_ORDER_RECEIVED: "Permanent order received",
  PROBATION_EXTENDED: "Probation extended",
  NOT_RECOMMENDED: "Not recommended",
  [NONE_KEY]: "No outcome",
};

export const PROBATION_LABELS: Record<string, string> = {
  due30: "Probation ending in 30 days",
  overdue: "Overdue — probation ended, no outcome",
  ended: "Probation ended",
};

export const FACULTY_STATE_LABELS: Record<string, string> = {
  active: "Active (not left)",
  LEFT: "Left",
  ON_LEAVE: "On leave",
  [NONE_KEY]: "No status",
};

export const ROLE_LABELS: Record<string, string> = {
  HOD: "HOD",
  MEMBER: "Member",
  [NONE_KEY]: "No role",
};

/** A code's label, or the code itself when the sheet holds a value nobody
 * mapped -- shown, never hidden. */
export function labelFor(labels: Record<string, string>, code: string | null | undefined): string {
  if (code === null || code === undefined || code === "") return labels[NONE_KEY] ?? "—";
  return labels[code] ?? code;
}

export function monthLabel(month: string): string {
  if (month === "undated") return "No readable joining date";
  const [year, mon] = month.split("-").map(Number);
  if (!year || !mon) return month;
  return new Date(year, mon - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

/** Asia/Calcutta, like the Talent Pool's freshness line. */
export function formatSyncTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Calcutta",
  });
}

export function syncLine(lastSyncAt: string | null): string {
  return lastSyncAt
    ? `Synced from the Google Sheet · last sync ${formatSyncTime(lastSyncAt)}`
    : "Not synced from the Google Sheet yet.";
}
