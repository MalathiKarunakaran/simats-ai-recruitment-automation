import { useSearchParams } from "react-router-dom";

import type { CategoryTabValue } from "@/components/domain/CategoryTabs";

// New pattern for this codebase -- no existing page syncs a filter to the
// URL (useSearchParams elsewhere is read-only, once, for create-page
// prefill). This hook is the one shared piece of URL-sync logic every
// category-filtered list page imports, rather than each page reinventing it.
//
// URL shape: `?category=teaching|non-teaching|housekeeping`, absent (or any
// other value) reading back as "ALL". Lowercase-hyphenated in the URL (a
// human-shareable link convention) but StaffRoleCategoryEnum's real
// upper-snake-case values everywhere else in the app -- this hook is the one
// place that translates between the two.
const URL_TO_CATEGORY: Record<string, CategoryTabValue> = {
  teaching: "TEACHING",
  "non-teaching": "NON_TEACHING",
  housekeeping: "HOUSEKEEPING",
};

const CATEGORY_TO_URL: Record<CategoryTabValue, string | null> = {
  ALL: null,
  TEACHING: "teaching",
  NON_TEACHING: "non-teaching",
  HOUSEKEEPING: "housekeeping",
};

export function useCategoryTabState(
  paramName = "category",
): [CategoryTabValue, (value: CategoryTabValue) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const raw = searchParams.get(paramName);
  const value: CategoryTabValue = (raw && URL_TO_CATEGORY[raw]) || "ALL";

  function setValue(next: CategoryTabValue) {
    // Functional updater + { replace: false } (the default, spelled out for
    // clarity): merges with whatever other query params a page already has
    // (never clobbers them) and pushes a new history entry so back/forward
    // moves through category changes one step at a time, same as any other
    // filter change would if it were URL-backed.
    setSearchParams(
      (prev) => {
        const next_ = new URLSearchParams(prev);
        const urlValue = CATEGORY_TO_URL[next];
        if (urlValue) next_.set(paramName, urlValue);
        else next_.delete(paramName);
        return next_;
      },
      { replace: false },
    );
  }

  return [value, setValue];
}
