import { useSearchParams } from "react-router-dom";

import type { CategoryTabValue } from "@/components/domain/CategoryTabs";

// New pattern for this codebase -- no existing page syncs a filter to the
// URL (useSearchParams elsewhere is read-only, once, for create-page
// prefill). This hook is the one shared piece of URL-sync logic every
// category-filtered list page imports, rather than each page reinventing it.
//
// URL shape: `?category=teaching|non-teaching|housekeeping|all`, absent (or
// any other value) reading back as `defaultValue` (default "ALL", see
// below). Lowercase-hyphenated in the URL (a human-shareable link
// convention) but StaffRoleCategoryEnum's real upper-snake-case values
// everywhere else in the app -- this hook is the one place that translates
// between the two.
const URL_TO_CATEGORY: Record<string, CategoryTabValue> = {
  all: "ALL",
  teaching: "TEACHING",
  "non-teaching": "NON_TEACHING",
  housekeeping: "HOUSEKEEPING",
};

const CATEGORY_TO_URL: Record<CategoryTabValue, string> = {
  ALL: "all",
  TEACHING: "teaching",
  NON_TEACHING: "non-teaching",
  HOUSEKEEPING: "housekeeping",
};

// `defaultValue` (glowing-zooming-hamming.md Phase E) -- optional, additive,
// backward-compatible: every existing call site (VacancyRequestsListPage,
// DesignationsPage, DepartmentsPage, DashboardPage, CandidatesListPage,
// ApplicationsListPage, LocationsPage, JobPostingsListPage, ReportsPage)
// calls this with zero or one argument and keeps its current "ALL" default
// unchanged. SanctionedStrengthPage is the one caller that passes
// `defaultValue: "TEACHING"` (its own default-tab gap fix) without touching
// this hook's own default for anyone else. The value a page picks as
// "default" is the one omitted from the URL (same "omit the unselected
// default state" convention as before, just generalized off a literal
// "ALL" to whatever this page's own default is) -- selecting a *different*
// category always writes it explicitly, including "ALL" itself when it
// isn't the page's default (see setValue below).
export function useCategoryTabState(
  paramName = "category",
  defaultValue: CategoryTabValue = "ALL",
): [CategoryTabValue, (value: CategoryTabValue) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const raw = searchParams.get(paramName);
  const value: CategoryTabValue = (raw && URL_TO_CATEGORY[raw]) || defaultValue;

  function setValue(next: CategoryTabValue) {
    // Functional updater + { replace: false } (the default, spelled out for
    // clarity): merges with whatever other query params a page already has
    // (never clobbers them) and pushes a new history entry so back/forward
    // moves through category changes one step at a time, same as any other
    // filter change would if it were URL-backed.
    setSearchParams(
      (prev) => {
        const next_ = new URLSearchParams(prev);
        if (next === defaultValue) next_.delete(paramName);
        else next_.set(paramName, CATEGORY_TO_URL[next]);
        return next_;
      },
      { replace: false },
    );
  }

  return [value, setValue];
}
