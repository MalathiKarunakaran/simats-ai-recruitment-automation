import { describe, expect, it } from "vitest";

import { computeFacets, countDistinct, countMatching, emptyFilters, toggleValue, type CrossFilters, type DimensionSpec } from "@/components/talentPool/crossFilter";

interface Row {
  college: string | null;
  department: string | null;
  gender: string | null;
}

const rows: Row[] = [
  { college: "SSE", department: "ECE", gender: "Male" },
  { college: "SSE", department: "ECE", gender: "Female" },
  { college: "SSE", department: "CSE", gender: null },
  { college: "SCAD", department: "ECE", gender: "Female" },
  { college: "SCLAS", department: "Maths", gender: "Male" },
  { college: null, department: "CSE", gender: "Male" },
];

const dimensions: DimensionSpec<Row>[] = [
  { key: "college", value: (row) => row.college },
  { key: "department", value: (row) => row.department },
  { key: "gender", value: (row) => row.gender },
];

function pick(values: Partial<Record<keyof CrossFilters, string[]>>): CrossFilters {
  const filters = emptyFilters();
  for (const [key, list] of Object.entries(values)) filters[key as keyof CrossFilters] = new Set(list);
  return filters;
}

const counts = (facet: { items: { label: string; count: number }[] }) =>
  Object.fromEntries(facet.items.map((item) => [item.label, item.count]));

describe("computeFacets", () => {
  it("with no filters counts every row and leaves blanks unrecorded", () => {
    const facets = computeFacets(rows, emptyFilters(), dimensions);
    expect(counts(facets.college)).toEqual({ SSE: 3, SCAD: 1, SCLAS: 1 });
    expect(facets.college.recorded).toBe(5);
    expect(facets.college.base).toBe(6);
    expect(facets.gender.recorded).toBe(5);
    expect(countMatching(rows, emptyFilters(), dimensions)).toBe(6);
  });

  it("one filter narrows the other charts", () => {
    const filters = pick({ college: ["SSE"] });
    const facets = computeFacets(rows, filters, dimensions);
    expect(countMatching(rows, filters, dimensions)).toBe(3);
    expect(counts(facets.department)).toEqual({ ECE: 2, CSE: 1, Maths: 0 });
    expect(facets.department.base).toBe(3);
    expect(counts(facets.gender)).toEqual({ Male: 1, Female: 1 });
    expect(facets.gender.recorded).toBe(2);
    expect(facets.gender.base).toBe(3);
  });

  it("values in one chart combine with OR", () => {
    const filters = pick({ college: ["SSE", "SCAD"] });
    const facets = computeFacets(rows, filters, dimensions);
    expect(countMatching(rows, filters, dimensions)).toBe(4);
    expect(counts(facets.department)).toEqual({ ECE: 3, CSE: 1, Maths: 0 });
  });

  it("different charts combine with AND", () => {
    const filters = pick({ college: ["SSE", "SCAD"], department: ["ECE"] });
    const facets = computeFacets(rows, filters, dimensions);
    expect(countMatching(rows, filters, dimensions)).toBe(3);
    expect(counts(facets.gender)).toEqual({ Male: 1, Female: 2 });
  });

  it("a chart ignores its own filter and is counted over the other charts' filters", () => {
    const facets = computeFacets(rows, pick({ college: ["SSE"], department: ["ECE"] }), dimensions);
    expect(counts(facets.college)).toEqual({ SSE: 2, SCAD: 1, SCLAS: 0 });
    expect(facets.college.base).toBe(3);
    expect(counts(facets.department)).toEqual({ ECE: 2, CSE: 1, Maths: 0 });
    expect(facets.department.base).toBe(3);
  });

  it("a row blank in a filtered chart does not match it", () => {
    expect(countMatching(rows, pick({ gender: ["Male", "Female"] }), dimensions)).toBe(5);
  });

  it("keeps bars in their unfiltered order, however the counts change", () => {
    const facets = computeFacets(rows, pick({ department: ["Maths"] }), dimensions);
    expect(facets.college.items).toEqual([
      { label: "SSE", count: 0 },
      { label: "SCAD", count: 0 },
      { label: "SCLAS", count: 1 },
    ]);
  });

  it("counts what came from resumes within the chart's own rows", () => {
    const withResume: DimensionSpec<Row>[] = [
      { key: "college", value: (row) => row.college },
      { key: "gender", value: (row) => row.gender, fromResume: (row) => row.gender === "Female" },
    ];
    expect(computeFacets(rows, emptyFilters(), withResume).gender.fromResume).toBe(2);
    expect(computeFacets(rows, pick({ college: ["SCLAS"] }), withResume).gender.fromResume).toBe(0);
  });
});

describe("countDistinct", () => {
  it("counts values left after every filter, the chart's own included", () => {
    expect(countDistinct(rows, emptyFilters(), dimensions, "college")).toBe(3);
    expect(countDistinct(rows, pick({ college: ["SSE"] }), dimensions, "college")).toBe(1);
    expect(countDistinct(rows, pick({ college: ["SSE"] }), dimensions, "department")).toBe(2);
  });
});

describe("toggleValue", () => {
  const values = (filters: CrossFilters) => [...filters.college].sort();

  it("a plain click selects, and again deselects", () => {
    const once = toggleValue(emptyFilters(), "college", "SSE", false);
    expect(values(once)).toEqual(["SSE"]);
    expect(values(toggleValue(once, "college", "SSE", false))).toEqual([]);
  });

  it("a plain click on another value replaces the chart's pick", () => {
    expect(values(toggleValue(pick({ college: ["SSE"] }), "college", "SCAD", false))).toEqual(["SCAD"]);
  });

  it("Ctrl/Cmd adds and removes", () => {
    const both = toggleValue(pick({ college: ["SSE"] }), "college", "SCAD", true);
    expect(values(both)).toEqual(["SCAD", "SSE"]);
    expect(values(toggleValue(both, "college", "SSE", true))).toEqual(["SCAD"]);
  });

  it("leaves other charts alone and does not change what it was given", () => {
    const before = pick({ college: ["SSE"], department: ["ECE"] });
    const after = toggleValue(before, "college", "SCAD", true);
    expect([...after.department]).toEqual(["ECE"]);
    expect([...before.college]).toEqual(["SSE"]);
  });
});
