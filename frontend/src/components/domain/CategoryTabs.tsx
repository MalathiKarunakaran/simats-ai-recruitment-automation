import { Tabs } from "@/components/ui/tabs";
import type { StaffRoleCategory } from "@/api/types";

// Every page that filters by staff category (Vacancy Requests, Departments,
// Vacancy Register, Designation Master, Job Postings, Applications,
// Candidates) shares this one value shape -- StaffRoleCategoryEnum plus an
// "ALL" sentinel for the unselected state. Mirrors app/models/enums.py's
// StaffRoleCategoryEnum exactly, same as StaffRoleCategory itself.
export type CategoryTabValue = StaffRoleCategory | "ALL";

// Caller supplies whatever counts it has -- server-provided (Vacancy
// Register/Designation Master's category_counts) or client-computed
// (everywhere else, via .filter().length over an already-fetched list).
// `all` is optional: omit it to render without the "All" tab (no page in
// this rollout does that today, but the component doesn't require it).
export interface CategoryTabCounts {
  all?: number;
  teaching: number;
  nonTeaching: number;
  housekeeping: number;
}

interface CategoryTabsProps {
  value: CategoryTabValue;
  onValueChange: (value: CategoryTabValue) => void;
  counts: CategoryTabCounts;
  className?: string;
  /** Forwarded to the underlying Tabs primitive -- "pill" (default) keeps
   * every existing consumer's current look; "segmented" is DashboardPage's
   * own opt-in for a visually stronger active state (see ui/tabs.tsx). */
  variant?: "pill" | "segmented";
}

// Maps a backend `category_counts` snapshot (VacancyRegisterListResponse/
// DesignationListResponse: {"TEACHING": n, "NON_TEACHING": n,
// "HOUSEKEEPING": n, "ALL": n}) to this component's counts prop shape --
// shared by every server-count page (Vacancy Register, Designation Master)
// so the key-name translation lives in exactly one place.
export function mapServerCategoryCounts(counts: Record<string, number> | undefined): CategoryTabCounts {
  return {
    all: counts?.ALL ?? 0,
    teaching: counts?.TEACHING ?? 0,
    nonTeaching: counts?.NON_TEACHING ?? 0,
    housekeeping: counts?.HOUSEKEEPING ?? 0,
  };
}

// Thin wrapper around components/ui/tabs.tsx's dependency-free Tabs --
// fixed All | Teaching | Non-Teaching | Housekeeping order, each label
// carrying a live count (e.g. "Teaching (18)"). Presentational/controlled
// only; pairs with hooks/useCategoryTabState.ts for URL persistence, but
// doesn't require it -- a page can also just useState() the value.
export function CategoryTabs({ value, onValueChange, counts, className, variant }: CategoryTabsProps) {
  const tabs = [
    ...(counts.all !== undefined ? [{ value: "ALL" as const, label: `All (${counts.all})` }] : []),
    { value: "TEACHING" as const, label: `Teaching (${counts.teaching})` },
    { value: "NON_TEACHING" as const, label: `Non-Teaching (${counts.nonTeaching})` },
    { value: "HOUSEKEEPING" as const, label: `Housekeeping (${counts.housekeeping})` },
  ];
  return <Tabs value={value} onValueChange={onValueChange} tabs={tabs} className={className} variant={variant} />;
}
