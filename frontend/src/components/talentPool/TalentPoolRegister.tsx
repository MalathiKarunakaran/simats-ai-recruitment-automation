import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { listTalentPool } from "@/api/talentPool";
import type { TalentPoolEntryRead, TalentPoolSourceTab, TalentPoolSummary } from "@/api/types";
import { CLEARED_FILTERS, describeFilters } from "@/components/talentPool/filterHref";
import { eligibilityTone, statusTone, toneVariant } from "@/components/talentPool/statusTone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

/**
 * The candidate register (spec 1.6): filters, search, pagination, and a row
 * that opens the entry sheet. Read-only -- there is no control here that
 * edits a candidate.
 *
 * Every filter is URL state, owned by the page, so a tile or a department
 * row can set one and this component simply renders what the URL says. That
 * is also why the filter dropdowns take their options from the SUMMARY
 * rather than from a hardcoded list: the summary is computed over the same
 * rows, so a status that exists in the sheet is always offered, and one
 * that does not is never offered as an empty filter.
 */

const PAGE_SIZE = 25;
const ALL = "__all__";

export interface RegisterFilters {
  q: string;
  status: string;
  department: string;
  eligibility: string;
  /** Breakdown and chart filters (2026-10-31). No dropdown sets these -- a
   * clicked count does -- so the "Showing:" line below is how a reader sees
   * and clears them. */
  source: string;
  calledBy: string;
  appliedPost: string;
  /** `YYYY-MM`, or "undated". */
  month: string;
  undecided: boolean;
  includeInactive: boolean;
  offset: number;
}

interface TalentPoolRegisterProps {
  tab: TalentPoolSourceTab;
  deptMode: "group" | "raw";
  summary: TalentPoolSummary;
  filters: RegisterFilters;
  onFiltersChange: (next: Partial<RegisterFilters>) => void;
  onOpenEntry: (entry: TalentPoolEntryRead) => void;
}

export function TalentPoolRegister({
  tab,
  deptMode,
  summary,
  filters,
  onFiltersChange,
  onOpenEntry,
}: TalentPoolRegisterProps) {
  const teaching = tab === "TEACHING_FINAL";

  // Typed text is local and debounced; the URL (and the request) only moves
  // 300ms after typing stops, so a search does not fire a request per key.
  const [typed, setTyped] = useState(filters.q);
  useEffect(() => setTyped(filters.q), [filters.q]);
  useEffect(() => {
    if (typed === filters.q) return;
    const timer = setTimeout(() => onFiltersChange({ q: typed, offset: 0 }), 300);
    return () => clearTimeout(timer);
  }, [typed, filters.q, onFiltersChange]);

  const listQuery = useQuery({
    queryKey: [
      "talent-pool",
      "list",
      tab,
      deptMode,
      filters.q,
      filters.status,
      filters.department,
      filters.eligibility,
      filters.source,
      filters.calledBy,
      filters.appliedPost,
      filters.month,
      filters.undecided,
      filters.includeInactive,
      filters.offset,
    ],
    queryFn: () =>
      listTalentPool({
        source_tab: tab,
        q: filters.q || undefined,
        sheet_status: filters.status || undefined,
        dept_mode: deptMode,
        department: filters.department || undefined,
        eligibility: filters.eligibility || undefined,
        source: filters.source || undefined,
        called_by: filters.calledBy || undefined,
        applied_post: filters.appliedPost || undefined,
        month: filters.month || undefined,
        undecided: filters.undecided,
        include_inactive: filters.includeInactive,
        limit: PAGE_SIZE,
        offset: filters.offset,
      }),
    // Keeps the previous page on screen while the next one loads, so paging
    // does not blink the table out of existence.
    placeholderData: keepPreviousData,
  });

  const statusOptions = Object.keys(summary.by_status).sort();
  const departmentOptions = summary.by_department.map((row) => row.department);
  const eligibilityOptions = Object.keys(summary.by_eligibility).sort();

  const data = listQuery.data;
  const columnCount = teaching ? 8 : 6;
  const activeFilters = describeFilters(filters, teaching);

  return (
    <section id="register" className="space-y-3 scroll-mt-4">
      <h2 className="text-sm font-semibold">Candidate register</h2>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Search name, email, phone, department, remarks"
          aria-label="Search candidates"
          className="h-8 w-full max-w-xs text-xs"
        />

        <Select
          value={filters.status || ALL}
          onValueChange={(value) => onFiltersChange({ status: value === ALL ? "" : value, offset: 0 })}
        >
          <SelectTrigger aria-label="Status filter" className="h-8 w-40 text-xs">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {statusOptions.map((status) => (
              <SelectItem key={status} value={status}>{status}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.department || ALL}
          onValueChange={(value) => onFiltersChange({ department: value === ALL ? "" : value, offset: 0 })}
        >
          <SelectTrigger aria-label="Department filter" className="h-8 w-48 text-xs">
            <SelectValue placeholder="All departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All departments</SelectItem>
            {departmentOptions.map((department) => (
              <SelectItem key={department} value={department}>{department}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {teaching ? (
          <Select
            value={filters.eligibility || ALL}
            onValueChange={(value) => onFiltersChange({ eligibility: value === ALL ? "" : value, offset: 0 })}
          >
            <SelectTrigger aria-label="Eligibility filter" className="h-8 w-44 text-xs">
              <SelectValue placeholder="All eligibility" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All eligibility</SelectItem>
              {eligibilityOptions.map((value) => (
                <SelectItem key={value} value={value}>{value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <label className="flex items-center gap-2 text-xs">
          <Switch
            checked={filters.includeInactive}
            onCheckedChange={(checked) => onFiltersChange({ includeInactive: checked, offset: 0 })}
            aria-label="Show removed rows"
          />
          Show removed rows
        </label>
      </div>

      {activeFilters.length > 0 ? (
        <div
          data-testid="talent-pool-active-filters"
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"
        >
          <p>
            <span className="font-semibold">Showing:</span> {activeFilters.join(" \u00b7 ")}
            {data ? (
              <span className="font-semibold">
                {` \u2014 ${data.total.toLocaleString("en-IN")} ${data.total === 1 ? "person" : "people"}`}
              </span>
            ) : null}
          </p>
          <Button variant="outline" size="sm" className="h-7" onClick={() => onFiltersChange(CLEARED_FILTERS)}>
            Clear filters
          </Button>
        </div>
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        {data ? `${data.total.toLocaleString("en-IN")} ${data.total === 1 ? "candidate" : "candidates"}` : "\u2026"}
      </p>

      {listQuery.isError ? (
        <p className="text-xs text-brand-danger">
          {listQuery.error instanceof Error ? listQuery.error.message : "Could not load the register"}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table data-testid="talent-pool-register-table" className="w-full min-w-[42rem] text-xs">
            <thead className="bg-card">
              <tr className="border-b border-border text-left">
                <th scope="col" className="px-2 py-1.5 font-medium">Name</th>
                {teaching ? (
                  <>
                    <th scope="col" className="px-2 py-1.5 font-medium">Department</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">Applied</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">Eligibility</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">Status</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">Interview</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">Called by</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">Resume</th>
                  </>
                ) : (
                  <>
                    <th scope="col" className="px-2 py-1.5 font-medium">Applied post</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">Department</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">Call date</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">Status</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">Remarks</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {data && data.items.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-2 py-6 text-center text-muted-foreground">
                    No candidates match these filters.
                  </td>
                </tr>
              ) : null}

              {data?.items.map((entry) => (
                <tr
                  key={entry.id}
                  tabIndex={0}
                  onClick={() => onOpenEntry(entry)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenEntry(entry);
                    }
                  }}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <td className="px-2 py-1.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{entry.full_name}</span>
                      {!entry.is_active ? <Badge variant="warning">Removed from sheet</Badge> : null}
                      {entry.application_id ? <Badge variant="info">In pipeline</Badge> : null}
                    </span>
                    {entry.email ? (
                      <span className="block text-[11px] text-muted-foreground">{entry.email}</span>
                    ) : null}
                  </td>

                  {teaching ? (
                    <>
                      <td className="px-2 py-1.5">
                        {entry.dept_group ?? entry.dept_raw ?? "\u2014"}
                        {/* The raw spelling is shown only when it differs --
                            repeating an identical value would be noise. */}
                        {entry.dept_raw && entry.dept_raw !== entry.dept_group ? (
                          <span className="block text-[11px] text-muted-foreground">{entry.dept_raw}</span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">{entry.applied_on ?? "\u2014"}</td>
                      <td className="px-2 py-1.5">
                        {entry.eligibility ? (
                          <Badge variant={toneVariant(eligibilityTone(entry.eligibility))}>
                            {entry.eligibility}
                          </Badge>
                        ) : (
                          "\u2014"
                        )}
                        {entry.eligibility_raw && entry.eligibility_raw !== entry.eligibility ? (
                          <span className="block text-[11px] text-muted-foreground">{entry.eligibility_raw}</span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge variant={toneVariant(statusTone(entry.sheet_status))}>{entry.sheet_status}</Badge>
                      </td>
                      <td className="px-2 py-1.5">{entry.interview_on_raw ?? "\u2014"}</td>
                      <td className="px-2 py-1.5">{entry.called_by ?? "\u2014"}</td>
                      <td className="px-2 py-1.5">
                        {entry.resume_url?.startsWith("https://") ? (
                          <a
                            href={entry.resume_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="inline-flex items-center gap-1 text-brand-primary underline"
                          >
                            Open <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        ) : (
                          "\u2014"
                        )}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-2 py-1.5">{entry.applied_post ?? "\u2014"}</td>
                      <td className="px-2 py-1.5">{entry.dept_group ?? entry.dept_raw ?? "\u2014"}</td>
                      <td className="px-2 py-1.5 tabular-nums">{entry.applied_on ?? "\u2014"}</td>
                      <td className="px-2 py-1.5">
                        <Badge variant={toneVariant(statusTone(entry.sheet_status))}>{entry.sheet_status}</Badge>
                        {entry.status_from_remark ? (
                          <span className="block text-[11px] text-muted-foreground">from remark</span>
                        ) : null}
                      </td>
                      <td className="max-w-[18rem] px-2 py-1.5">
                        <span className="line-clamp-2">{entry.remarks ?? "\u2014"}</span>
                      </td>
                    </>
                  )}
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
          onOffsetChange={(offset) => onFiltersChange({ offset })}
          itemLabel="candidates"
        />
      ) : null}
    </section>
  );
}
