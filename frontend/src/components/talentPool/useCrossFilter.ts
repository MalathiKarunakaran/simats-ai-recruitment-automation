import { useCallback, useMemo, useState } from "react";

import { emptyFilters, hasFilters, toggleValue, type CrossFilters, type Dimension } from "@/components/talentPool/crossFilter";

/** The one filter state for the whole Selected panel. */
export function useCrossFilter() {
  const [filters, setFilters] = useState<CrossFilters>(emptyFilters);

  const toggle = useCallback((key: Dimension, label: string, additive: boolean) => {
    setFilters((current) => toggleValue(current, key, label, additive));
  }, []);
  const clearDimension = useCallback((key: Dimension) => {
    setFilters((current) => (current[key].size > 0 ? { ...current, [key]: new Set<string>() } : current));
  }, []);
  const clearAll = useCallback(() => {
    setFilters((current) => (hasFilters(current) ? emptyFilters() : current));
  }, []);

  const active = useMemo(() => hasFilters(filters), [filters]);
  return { filters, active, toggle, clearDimension, clearAll };
}
