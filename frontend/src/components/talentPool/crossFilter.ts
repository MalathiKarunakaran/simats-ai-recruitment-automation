import type { TalentPoolSelectedRow } from "@/api/types";

/**
 * The Selected panel's cross-filtering, as pure functions. Values picked in one
 * chart combine with OR, picks in different charts with AND, and a chart is
 * never narrowed by its own picks: it keeps showing what else could be picked.
 */

export const DIMENSION_KEYS = ["status", "reference", "source", "gender", "college", "country", "state", "department"] as const;

export type Dimension = (typeof DIMENSION_KEYS)[number];
export type CrossFilters = Record<Dimension, Set<string>>;

export interface DimensionSpec<Row> {
  key: Dimension;
  /** Null when the row does not record it: never a bar, never counted. */
  value: (row: Row) => string | null;
  fromResume?: (row: Row) => boolean;
}

export interface Facet {
  /** Every value in the rows, whatever the filters. Order is by the unfiltered
   * count, so a bar never moves and one that drops to 0 stays in place. */
  items: { label: string; count: number }[];
  /** How many of `base` record this dimension. */
  recorded: number;
  fromResume: number;
  /** The same count, per value, for a chart narrowed to its picks. */
  fromResumeByLabel: Record<string, number>;
  /** The rows this chart is counted over: those matching every OTHER chart's
   * filters. The same as the filtered set unless this chart has picks. */
  base: number;
}

export function emptyFilters(): CrossFilters {
  return {
    status: new Set(),
    reference: new Set(),
    source: new Set(),
    gender: new Set(),
    college: new Set(),
    country: new Set(),
    state: new Set(),
    department: new Set(),
  };
}

export function hasFilters(filters: CrossFilters): boolean {
  return DIMENSION_KEYS.some((key) => filters[key].size > 0);
}

function matches<Row>(row: Row, filters: CrossFilters, dimensions: DimensionSpec<Row>[], except?: Dimension): boolean {
  return dimensions.every(({ key, value }) => {
    if (key === except || filters[key].size === 0) return true;
    const cell = value(row);
    return cell !== null && filters[key].has(cell);
  });
}

export function filterRows<Row>(rows: Row[], filters: CrossFilters, dimensions: DimensionSpec<Row>[]): Row[] {
  return rows.filter((row) => matches(row, filters, dimensions));
}

export function countMatching<Row>(rows: Row[], filters: CrossFilters, dimensions: DimensionSpec<Row>[]): number {
  return filterRows(rows, filters, dimensions).length;
}

/** How many different values of one dimension the fully filtered rows hold. */
export function countDistinct<Row>(rows: Row[], filters: CrossFilters, dimensions: DimensionSpec<Row>[], key: Dimension): number {
  const spec = dimensions.find((dimension) => dimension.key === key);
  const seen = new Set<string>();
  for (const row of rows) {
    const cell = spec?.value(row) ?? null;
    if (cell !== null && matches(row, filters, dimensions)) seen.add(cell);
  }
  return seen.size;
}

export function computeFacets<Row>(
  rows: Row[],
  filters: CrossFilters,
  dimensions: DimensionSpec<Row>[],
): Record<Dimension, Facet> {
  const facets = {} as Record<Dimension, Facet>;
  for (const { key, value, fromResume } of dimensions) {
    const everywhere = new Map<string, number>();
    const here = new Map<string, number>();
    let base = 0;
    let resumed = 0;
    const resumedByLabel: Record<string, number> = {};
    for (const row of rows) {
      const cell = value(row);
      if (cell !== null) everywhere.set(cell, (everywhere.get(cell) ?? 0) + 1);
      if (!matches(row, filters, dimensions, key)) continue;
      base += 1;
      if (cell !== null) here.set(cell, (here.get(cell) ?? 0) + 1);
      if (fromResume?.(row)) {
        resumed += 1;
        if (cell !== null) resumedByLabel[cell] = (resumedByLabel[cell] ?? 0) + 1;
      }
    }
    facets[key] = {
      items: [...everywhere.entries()]
        .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
        .map(([label]) => ({ label, count: here.get(label) ?? 0 })),
      recorded: [...here.values()].reduce((sum, count) => sum + count, 0),
      fromResume: resumed,
      fromResumeByLabel: resumedByLabel,
      base,
    };
  }
  return facets;
}

/** A plain click replaces the chart's picks, or deselects a value already
 * picked. Ctrl/Cmd + click adds or removes one value and leaves the rest. */
export function toggleValue(filters: CrossFilters, key: Dimension, label: string, additive: boolean): CrossFilters {
  const picked = filters[key].has(label);
  let next: Set<string>;
  if (additive || picked) {
    next = new Set(filters[key]);
    if (picked) next.delete(label);
    else next.add(label);
  } else {
    next = new Set([label]);
  }
  return { ...filters, [key]: next };
}

/** The panel's charts. Department reads whichever column is being viewed. */
export function selectedDimensions(deptMode: "group" | "raw"): DimensionSpec<TalentPoolSelectedRow>[] {
  return [
    { key: "status", value: (row) => row.status },
    { key: "reference", value: (row) => row.reference },
    { key: "source", value: (row) => row.source },
    { key: "gender", value: (row) => row.gender, fromResume: (row) => row.gender_from_resume },
    { key: "college", value: (row) => row.college },
    { key: "country", value: (row) => row.country, fromResume: (row) => row.country_from_resume },
    { key: "state", value: (row) => row.state, fromResume: (row) => row.state_from_resume },
    { key: "department", value: (row) => (deptMode === "raw" ? row.dept_raw : row.dept_group) },
  ];
}
