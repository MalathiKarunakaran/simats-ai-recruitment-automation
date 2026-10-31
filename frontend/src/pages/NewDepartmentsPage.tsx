import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { getDepartmentsSummary, listFaculty } from "@/api/joiningRecords";
import type { ApprovedDepartmentRow, UnmatchedDepartmentRow } from "@/api/joiningRecords";
import { ActiveFiltersLine } from "@/components/joining/ActiveFiltersLine";
import {
  FACULTY_STATE_LABELS,
  LIST_ID,
  ROLE_LABELS,
  countHref,
  labelFor,
  syncLine,
  withParams,
} from "@/components/joining/joiningLinks";
import { SearchBox } from "@/components/joining/SearchBox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { Switch } from "@/components/ui/switch";
import { useScrollToHash } from "@/hooks/useScrollToHash";
import { cn } from "@/lib/utils";

/**
 * New Departments (docs/specs/joining-screens.md, screen 3). One table of
 * every department: the approved ones from the New Departments sheet first,
 * then every Faculty-tab department name that matched no approved one, each
 * with the same faculty counts. Each number links to the faculty list below,
 * filtered to exactly the people it counted. A Faculty-tab-only row links with
 * matched=false, so a name that equals an approved one still opens its own
 * rows.
 *
 * "Active" means not marked Left -- on-leave staff still hold the post -- and
 * Gap is approved (count + additional) minus active.
 */

const PATH = "/new-departments";
const PAGE_SIZE = 25;
const MEANING = ["department", "role", "state", "additional", "matched"] as const;

type DepartmentRow = ApprovedDepartmentRow | UnmatchedDepartmentRow;

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

const countLink =
  "rounded-sm tabular-nums underline decoration-border underline-offset-2 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

export function NewDepartmentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const get = (key: string) => searchParams.get(key) ?? "";
  const includeInactive = get("include_inactive") === "true";
  const bool = (key: string) => (get(key) === "true" ? true : get(key) === "false" ? false : undefined);
  const filters = {
    q: get("q"),
    department: get("department"),
    role: get("role"),
    state: get("state"),
    additional: bool("additional"),
    matched: bool("matched"),
    offset: Math.max(0, Number(get("offset")) || 0),
  };

  const summaryQuery = useQuery({
    queryKey: ["joining-records", "departments", includeInactive],
    queryFn: () => getDepartmentsSummary(includeInactive),
  });
  const listQuery = useQuery({
    queryKey: ["joining-records", "faculty", searchParams.toString()],
    queryFn: () =>
      listFaculty({
        q: filters.q || undefined,
        department: filters.department || undefined,
        role: filters.role || undefined,
        state: filters.state || undefined,
        additional: filters.additional,
        matched: filters.matched,
        include_inactive: includeInactive || undefined,
        limit: PAGE_SIZE,
        offset: filters.offset,
      }),
    placeholderData: keepPreviousData,
  });
  const summary = summaryQuery.data;
  // Approved first, then the Faculty-tab-only names, each by name.
  const rows: DepartmentRow[] = summary
    ? [...[...summary.departments].sort(byName), ...[...summary.unmatched].sort(byName)]
    : [];
  const data = listQuery.data;
  useScrollToHash(LIST_ID, Boolean(summary) && (data !== undefined || listQuery.isError));

  const update = useCallback(
    (next: Record<string, string | boolean | number | undefined>) =>
      setSearchParams(withParams(searchParams, next), { replace: true }),
    [searchParams, setSearchParams],
  );
  const changeSearch = useCallback((q: string) => update({ q, offset: 0 }), [update]);
  const href = (set: Partial<Record<(typeof MEANING)[number], string>>) => countHref(PATH, MEANING, set, searchParams);

  const parts: string[] = [];
  if (filters.department) parts.push(`Department: ${filters.department}`);
  if (filters.role) parts.push(`Role: ${labelFor(ROLE_LABELS, filters.role)}`);
  if (filters.state) parts.push(labelFor(FACULTY_STATE_LABELS, filters.state));
  if (filters.additional === true) parts.push("Additional faculty");
  if (filters.additional === false) parts.push("Not additional");
  if (filters.matched === false) parts.push("Department not matched");
  if (filters.matched === true) parts.push("Department matched");
  if (filters.q) parts.push(`Search: “${filters.q}”`);
  if (includeInactive) parts.push("Including removed rows");

  /** A count that links to its list, or a plain zero (nothing to open). */
  const num = (value: number, to: string, label: string) =>
    value > 0 ? (
      <Link to={to} className={countLink} aria-label={label}>
        {value}
      </Link>
    ) : (
      <span className="tabular-nums text-muted-foreground">0</span>
    );

  return (
    <div className="space-y-4 px-4 py-4 sm:px-6">
      <header className="min-w-0">
        <h1 className="flex items-center gap-2 font-display text-xl font-bold">
          <Building2 className="h-5 w-5 text-brand-primary" aria-hidden="true" />
          New Departments
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {summary ? syncLine(summary.last_sync_at) : "Loading…"}
        </p>
      </header>

      {summaryQuery.isError ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <p className="text-xs text-brand-danger">
              {summaryQuery.error instanceof Error ? summaryQuery.error.message : "Could not load the departments"}
            </p>
            <Button variant="outline" size="sm" onClick={() => void summaryQuery.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : summaryQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading&hellip;</p>
      ) : summary && summary.departments.length === 0 && summary.faculty_total === 0 && !includeInactive ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium">No departments synced yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              This page fills from the New Departments sheet once its sync has run (Administration &rarr; Data Sync Status).
            </p>
          </CardContent>
        </Card>
      ) : summary ? (
        <>
          <Card>
            <CardContent className="p-3">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">
                  Departments{" "}
                  <span data-testid="department-counts" className="font-normal text-muted-foreground">
                    {rows.length} departments · {summary.departments.length} approved · {summary.unmatched.length} only in
                    the Faculty tab
                  </span>
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  <Link to={href({})} className={countLink}>
                    {summary.faculty_total.toLocaleString("en-IN")} faculty rows
                  </Link>
                  {" · "}
                  {summary.unmatched_total > 0 ? (
                    <Link to={href({ matched: "false" })} className={countLink}>
                      {summary.unmatched_total.toLocaleString("en-IN")} not matched to an approved department
                    </Link>
                  ) : (
                    "all matched to an approved department"
                  )}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table data-testid="department-table" className="w-full min-w-[48rem] text-xs">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th scope="col" className="px-2 py-1.5 font-medium">Department</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">Approved</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">Additional</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">Active</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">of whom additional</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">Left</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">On leave</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">Gap</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">HOD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => {
                      // A Faculty-tab-only name opens with matched=false so it
                      // never resolves to an approved department of the same name.
                      const at = (set: Partial<Record<(typeof MEANING)[number], string>> = {}) =>
                        href(d.approved ? { department: d.name, ...set } : { department: d.name, matched: "false", ...set });
                      const selected =
                        filters.department === d.name && (d.approved ? filters.matched !== false : filters.matched === false);
                      return (
                        <tr
                          key={d.approved ? d.id : `faculty-tab:${d.name}`}
                          className={cn("border-b border-border last:border-0", selected && "bg-muted/50")}
                        >
                          <td className="px-2 py-1.5">
                            <Link to={at()} className={cn(countLink, "font-medium")}>
                              {d.name}
                            </Link>
                            {d.approved ? (
                              <>
                                {!d.is_active ? <Badge variant="warning" className="ml-1.5">Removed from sheet</Badge> : null}
                                {d.notes ? <span className="block text-[11px] text-muted-foreground">{d.notes}</span> : null}
                              </>
                            ) : (
                              <Badge variant="outline" className="ml-1.5 px-1.5 py-0 text-[10px]">Not in Approved_Depts</Badge>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {d.approved ? (d.count ?? d.count_raw ?? "—") : <span className="text-muted-foreground">&mdash;</span>}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {d.approved ? (
                              (d.additional_count ?? d.additional_count_raw ?? "—")
                            ) : (
                              <span className="text-muted-foreground">&mdash;</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            {num(d.active, at({ state: "active" }), `${d.name}: ${d.active} active`)}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            {num(
                              d.active_additional,
                              at({ state: "active", additional: "true" }),
                              `${d.name}: ${d.active_additional} active additional`,
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            {num(d.left, at({ state: "LEFT" }), `${d.name}: ${d.left} left`)}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            {num(d.on_leave, at({ state: "ON_LEAVE" }), `${d.name}: ${d.on_leave} on leave`)}
                          </td>
                          {d.approved ? (
                            <td
                              className={cn(
                                "px-2 py-1.5 text-right font-medium tabular-nums",
                                d.gap > 0 ? "text-brand-warning" : d.gap < 0 ? "text-brand-info" : "text-brand-success",
                              )}
                              title={d.gap < 0 ? "More active faculty than approved" : undefined}
                            >
                              {d.gap}
                            </td>
                          ) : (
                            <td className="px-2 py-1.5 text-right text-muted-foreground" title="No approved count to compare with">
                              &mdash;
                            </td>
                          )}
                          <td className="px-2 py-1.5">{d.hods.length > 0 ? d.hods.join(", ") : <span className="text-muted-foreground">&mdash;</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <section id={LIST_ID} className="scroll-mt-4 space-y-3">
            <h2 className="text-sm font-semibold">Faculty</h2>
            <div className="flex flex-wrap items-center gap-2">
              <SearchBox value={filters.q} onChange={changeSearch} placeholder="Search name, Bio ID, department" label="Search faculty" />
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={includeInactive}
                  onCheckedChange={(checked) => update({ include_inactive: checked, offset: 0 })}
                  aria-label="Show removed rows"
                />
                Show removed rows
              </label>
            </div>

            <ActiveFiltersLine
              parts={parts}
              total={data?.total}
              noun={["person", "people"]}
              onClear={() => setSearchParams(new URLSearchParams(), { replace: true })}
            />

            {listQuery.isError ? (
              <p className="text-xs text-brand-danger">
                {listQuery.error instanceof Error ? listQuery.error.message : "Could not load the faculty"}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table data-testid="faculty-table" className="w-full min-w-[44rem] text-xs">
                  <thead className="bg-card">
                    <tr className="border-b border-border text-left">
                      <th scope="col" className="px-2 py-1.5 font-medium">Name</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Department</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Role</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Additional</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">State</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Linked joiner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data && data.items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">
                          No faculty match these filters.
                        </td>
                      </tr>
                    ) : null}
                    {data?.items.map((f) => (
                      <tr key={f.id} className="border-b border-border last:border-0">
                        <td className="px-2 py-1.5">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{f.full_name ?? "(no name)"}</span>
                            {!f.is_active ? <Badge variant="warning">Removed from sheet</Badge> : null}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">{f.bio_id ? `Bio ID ${f.bio_id}` : "—"}</span>
                        </td>
                        <td className="px-2 py-1.5">
                          {f.department_name ?? (
                            <span className="text-brand-warning">{f.dept_raw?.trim() || "Not set"}</span>
                          )}
                          {f.department_name && f.dept_raw && f.dept_raw.trim() !== f.department_name ? (
                            <span className="block text-[11px] text-muted-foreground">as typed: {f.dept_raw}</span>
                          ) : null}
                          {f.parent_dept_note ? (
                            <span className="block text-[11px] text-muted-foreground">from {f.parent_dept_note}</span>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5">
                          {f.role ? labelFor(ROLE_LABELS, f.role) : <span className="text-muted-foreground">{f.remark_raw ?? "—"}</span>}
                        </td>
                        <td className="px-2 py-1.5">{f.is_additional ? <Badge variant="info">Additional</Badge> : "—"}</td>
                        <td className="px-2 py-1.5">
                          {f.employment_state === "LEFT" ? (
                            <Badge variant="destructive">Left</Badge>
                          ) : f.employment_state === "ON_LEAVE" ? (
                            <Badge variant="warning">On leave</Badge>
                          ) : (
                            <Badge variant="success">Active</Badge>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {f.joinee_name ? (
                            <>
                              {f.joinee_name}
                              {f.joinee_designation ? (
                                <span className="block text-[11px] text-muted-foreground">{f.joinee_designation}</span>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-muted-foreground">&mdash;</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {data && data.total > PAGE_SIZE ? (
              <Pagination
                total={data.total}
                limit={PAGE_SIZE}
                offset={filters.offset}
                onOffsetChange={(offset) => update({ offset })}
                itemLabel="faculty"
              />
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
