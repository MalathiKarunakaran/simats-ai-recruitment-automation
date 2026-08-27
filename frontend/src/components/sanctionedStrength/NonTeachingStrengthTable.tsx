import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";

import { ApiError } from "@/api/client";
import { listDepartments } from "@/api/departments";
import { listDesignations } from "@/api/designations";
import { listEmployeesByDepartmentDesignation } from "@/api/employees";
import { listLocations } from "@/api/locations";
import {
  listNonTeachingStrengthRows,
  type NonTeachingStrengthSortBy,
  exportStrengthView,
} from "@/api/sanctionedStrengthViews";
import type { CampusRead, EmployeeRead, NonTeachingStrengthRow, NonTeachingStrengthStatus } from "@/api/types";
import { StrengthKpiSummary } from "@/components/sanctionedStrength/StrengthKpiSummary";
import { StrengthRowActions } from "@/components/sanctionedStrength/TeachingStrengthTable";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Non-Teaching operational view (glowing-zooming-hamming.md Phase F) -- the
// designation-level, every-row-inline table for categoryFilter ===
// "NON_TEACHING" on SanctionedStrengthPage. Structurally this is
// TeachingStrengthTable's sibling (same filters/sort/pagination shape,
// same GET /sanctioned-strength/views/* family, same StrengthRowActions
// cluster reused verbatim -- see that component's own docstring, updated in
// Phase H to the single-drawer-trigger shape) with two deliberate
// differences, both judgment calls documented here per this phase's plan:
//
// 1. Column set: the plan names a narrower column list for Non-Teaching
//    than Teaching actually renders -- "Department/Job Position/Block/
//    Location/Approved/Working/Vacancy/Status/Actions", dropping Teaching's
//    Campus and last_join/last_resignation/last_updated/filled_pct columns.
//    NonTeachingStrengthRow carries every one of those fields too (same
//    read-model grain as Teaching, see api/types.ts's own docstring) --
//    this is a **display-only** choice, not a data-availability one. Chose
//    to follow the plan's literal, narrower list rather than keep Teaching's
//    fuller column set for consistency: the plan calls this list out by
//    name specifically for this phase (unlike Phase E, which just said
//    "exact spec columns" without enumerating a narrower one), so treating
//    it as intentional rather than an oversight. Campus/filled_pct/last-*
//    values aren't lost -- Campus is still a real filter (for global-scope
//    roles) even though it's not a column, and the other three are simply
//    not shown for this view.
// 2. New expand-to-employees affordance (not present on Teaching's table
//    at all) -- a leading chevron column, same interaction shape as
//    SanctionedStrengthPage.tsx's own department-row-expands-to-designation-
//    breakdown pattern (Fragment + toggle button + a colSpan'd row
//    rendered directly below), chosen over an inline/always-visible sub-row
//    so the employee list is lazy-fetched only when actually requested
//    (same "don't fetch until expanded" rule that pattern already
//    establishes elsewhere on this page) rather than a modal/drawer, which
//    would be a new UI pattern for a small, single-purpose lookup this
//    table doesn't otherwise need.
//
// "Block" is Location.block_building -- NonTeachingStrengthRow itself only
// carries location_id/location_name (identical to Teaching's row), so this
// component joins against the same `locations` list already fetched for the
// Location filter dropdown (client-side lookup by location_id) rather than
// asking the backend to add a field this view's own schema deliberately
// keeps generic across both categories (see api/types.ts's own docstring
// for why NonTeachingStrengthRow mirrors TeachingStrengthRow field-for-
// field).

const PAGE_SIZE = 50;

const STATUS_VALUES: NonTeachingStrengthStatus[] = [
  "VACANCY_RECRUITMENT_REQUIRED",
  "FULLY_STAFFED",
  "OVERSTAFFED",
  "APPROVAL_PENDING",
  "INACTIVE",
];

// Same label/variant mapping as TeachingStrengthTable's own STATUS_DISPLAY
// -- the status vocabulary is genuinely shared (see
// app/services/sanctioned_strength_views.py's own docstring), so this is a
// deliberate literal duplication of a small constant, not an accidental
// drift risk -- mirrors this codebase's precedent of small self-contained
// per-component display maps rather than a shared cross-file constant for
// something this size.
const STATUS_DISPLAY: Record<NonTeachingStrengthStatus, { label: string; variant: BadgeProps["variant"] }> = {
  VACANCY_RECRUITMENT_REQUIRED: { label: "Vacancy/Recruitment Required", variant: "warning" },
  FULLY_STAFFED: { label: "Fully Staffed", variant: "success" },
  OVERSTAFFED: { label: "Overstaffed", variant: "outline" },
  APPROVAL_PENDING: { label: "Approval Pending", variant: "caution" },
  INACTIVE: { label: "Inactive", variant: "destructive" },
};

interface ColumnDef {
  key: string;
  label: string;
  sortBy?: NonTeachingStrengthSortBy;
}

// Per this component's own docstring, item 1: the plan's literal,
// deliberately narrower column list for Non-Teaching.
const COLUMNS: ColumnDef[] = [
  { key: "department_name", label: "Department", sortBy: "department_name" },
  { key: "designation_name", label: "Job Position", sortBy: "designation_name" },
  { key: "block", label: "Block" },
  { key: "location_name", label: "Location", sortBy: "location_name" },
  { key: "approved", label: "Approved", sortBy: "approved" },
  { key: "working", label: "Working", sortBy: "working" },
  { key: "vacancy", label: "Vacancy", sortBy: "vacancy" },
  { key: "status", label: "Status", sortBy: "status" },
  // Added for parity with TeachingStrengthTable.tsx's own fuller column set
  // (a real live inconsistency report, not a new feature) -- the backend
  // has always returned these 3 fields for Non-Teaching rows too
  // (NonTeachingStrengthRow shares TeachingStrengthRow's exact base shape,
  // and TEACHING_STRENGTH_SORT_FIELDS -- reused as-is for Non-Teaching per
  // that constant's own docstring -- already includes all 3 as valid sort
  // fields), so this is a pure display-layer addition, no backend change.
  { key: "last_join", label: "Last Join", sortBy: "last_join" },
  { key: "last_resignation", label: "Last Resignation", sortBy: "last_resignation" },
  { key: "last_updated", label: "Last Updated", sortBy: "last_updated" },
  { key: "actions", label: "Actions" },
];

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}
// +1 for the leading expand/chevron column, which carries no header label.
const TOTAL_COLUMN_COUNT = COLUMNS.length + 1;

function employmentStatusLabel(status: EmployeeRead["employment_status"]): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

// One expanded row's live employee list -- lazily fetched (only mounted
// while that row is expanded) via the new
// listEmployeesByDepartmentDesignation(department_id, designation_id) call.
function EmployeeExpandRow({ departmentId, designationId }: { departmentId: string; designationId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["employees-by-department-designation", departmentId, designationId],
    queryFn: () => listEmployeesByDepartmentDesignation(departmentId, designationId),
  });

  return (
    <tr className="bg-muted/40">
      <td colSpan={TOTAL_COLUMN_COUNT} className="px-3 py-3">
        {isLoading ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">Loading employees…</p>
        ) : isError ? (
          <p className="px-3 py-2 text-sm text-destructive">Failed to load employees for this designation.</p>
        ) : !data || data.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            No employees currently assigned to this department/designation.
          </p>
        ) : (
          <div className="max-w-2xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="py-1.5">Name</TableHead>
                  <TableHead className="py-1.5">Employee Code</TableHead>
                  <TableHead className="py-1.5">Employment Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((employee) => (
                  <TableRow key={employee.id}>
                    <TableCell className="py-1.5">{employee.full_name}</TableCell>
                    <TableCell className="py-1.5">{employee.employee_code}</TableCell>
                    <TableCell className="py-1.5">{employmentStatusLabel(employee.employment_status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </td>
    </tr>
  );
}

export interface NonTeachingStrengthTableProps {
  canManage: boolean;
  canViewAuditLog: boolean;
  canFilterByCampus: boolean;
  campuses: CampusRead[] | undefined;
}

export function NonTeachingStrengthTable({
  canManage,
  canViewAuditLog,
  canFilterByCampus,
  campuses,
}: NonTeachingStrengthTableProps) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<NonTeachingStrengthSortBy>("department_name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  const [departmentFilter, setDepartmentFilter] = useState<string>("ALL");
  const [designationFilter, setDesignationFilter] = useState<string>("ALL");
  const [locationFilter, setLocationFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<NonTeachingStrengthStatus | "ALL">("ALL");
  const [vacancyInput, setVacancyInput] = useState("");
  const [vacancyFilter, setVacancyFilter] = useState<number | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // Which (department_id, designation_id) rows currently show their
  // expanded employee list -- keyed by sanctioned_strength_id (the row's
  // own unique id), not the (department, designation) pair, matching
  // SanctionedStrengthPage.tsx's own expandedDepartmentIds convention of
  // keying by the row identity being toggled.
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(() => new Set());

  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: listDepartments });
  const { data: designations } = useQuery({
    queryKey: ["designations", "NON_TEACHING"],
    queryFn: () => listDesignations({ category: "NON_TEACHING" }),
  });
  const { data: locations } = useQuery({ queryKey: ["locations"], queryFn: listLocations });

  const nonTeachingDepartments = (departments ?? []).filter((department) => department.category === "NON_TEACHING");
  // Location.category is nullable (a building can serve multiple
  // categories) -- offered whenever it's either unset or explicitly
  // NON_TEACHING, same convention as TeachingStrengthTable's own filtering.
  const nonTeachingLocations = (locations ?? []).filter(
    (location) => location.category === null || location.category === "NON_TEACHING",
  );
  const blockByLocationId = new Map((locations ?? []).map((location) => [location.id, location.block_building]));

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "non-teaching-strength-view",
      page,
      sortBy,
      sortDir,
      campusFilter,
      departmentFilter,
      designationFilter,
      locationFilter,
      statusFilter,
      vacancyFilter,
      search,
    ],
    queryFn: () =>
      listNonTeachingStrengthRows({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        sort_by: sortBy,
        sort_dir: sortDir,
        campus_code: campusFilter === "ALL" ? null : campusFilter,
        department_id: departmentFilter === "ALL" ? null : departmentFilter,
        designation_id: designationFilter === "ALL" ? null : designationFilter,
        location_id: locationFilter === "ALL" ? null : locationFilter,
        status: statusFilter === "ALL" ? null : statusFilter,
        vacancy: vacancyFilter,
        search: search.trim() || null,
      }),
  });


  // Exports exactly what this table currently shows -- same filters, same
  // sort, minus pagination. Lives here rather than on SanctionedStrengthPage
  // because these filters are owned by this component, so a page-level button
  // could not see them and would silently export the wrong rows.
  const exportMutation = useMutation({
    mutationFn: () =>
      exportStrengthView("non-teaching", {
        campusCode: campusFilter === "ALL" ? null : campusFilter,
        departmentId: departmentFilter === "ALL" ? null : departmentFilter,
        designationId: designationFilter === "ALL" ? null : designationFilter,
        locationId: locationFilter === "ALL" ? null : locationFilter,
        status: statusFilter === "ALL" ? null : statusFilter,
        vacancy: vacancyFilter,
        search: search.trim() || null,
        sortBy,
        sortDir,
      }),
  });

  function handleSort(column: ColumnDef) {
    if (!column.sortBy) return;
    if (sortBy === column.sortBy) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column.sortBy);
      setSortDir("asc");
    }
    setPage(0);
  }

  function commitSearch() {
    setSearch(searchInput);
    setPage(0);
  }

  function commitVacancy() {
    const trimmed = vacancyInput.trim();
    setVacancyFilter(trimmed === "" ? null : Number(trimmed));
    setPage(0);
  }

  function toggleExpandedRow(sanctionedStrengthId: string) {
    setExpandedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(sanctionedStrengthId)) next.delete(sanctionedStrengthId);
      else next.add(sanctionedStrengthId);
      return next;
    });
  }

  const hasAnyFilter =
    campusFilter !== "ALL" ||
    departmentFilter !== "ALL" ||
    designationFilter !== "ALL" ||
    locationFilter !== "ALL" ||
    statusFilter !== "ALL" ||
    vacancyFilter !== null ||
    search.trim() !== "";

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const limit = data?.limit ?? PAGE_SIZE;
  // See TeachingStrengthTable.tsx's own comment on this same computation --
  // derived from local `page` state, not `data?.offset`, so Pagination's
  // Previous/Next enabled-state stays in sync with this component's own
  // pagination state.
  const offset = page * limit;

  return (
    <>
      <StrengthKpiSummary
        variant="APPROVED_WORKING"
        totalRecords={data?.status_counts.ALL}
        approvedOrRequired={data?.approved_total}
        workingOrAvailable={data?.working_total}
        vacancyTotal={data?.vacancy_total}
        fullyStaffed={data?.status_counts.FULLY_STAFFED}
        recruitmentRequired={data?.status_counts.VACANCY_RECRUITMENT_REQUIRED}
        isLoading={isLoading}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onBlur={commitSearch}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitSearch();
          }}
          placeholder="Search department or designation"
          aria-label="Search"
          className="sm:w-64"
        />
        {canFilterByCampus ? (
          <div className="w-40">
            <Select value={campusFilter} onValueChange={(v) => { setCampusFilter(v); setPage(0); }}>
              <SelectTrigger aria-label="Campus filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All campuses</SelectItem>
                {campuses?.map((campus) => (
                  <SelectItem key={campus.id} value={campus.code}>
                    {campus.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="w-48">
          <Select value={departmentFilter} onValueChange={(v) => { setDepartmentFilter(v); setPage(0); }}>
            <SelectTrigger aria-label="Department filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All departments</SelectItem>
              {nonTeachingDepartments.map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <Select value={designationFilter} onValueChange={(v) => { setDesignationFilter(v); setPage(0); }}>
            <SelectTrigger aria-label="Designation filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All designations</SelectItem>
              {(designations ?? []).map((designation) => (
                <SelectItem key={designation.id} value={designation.id}>
                  {designation.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Select value={locationFilter} onValueChange={(v) => { setLocationFilter(v); setPage(0); }}>
            <SelectTrigger aria-label="Location filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All locations</SelectItem>
              {nonTeachingLocations.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {location.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-56">
          <Select
            value={statusFilter}
            onValueChange={(v) => { setStatusFilter(v as NonTeachingStrengthStatus | "ALL"); setPage(0); }}
          >
            <SelectTrigger aria-label="Status filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {STATUS_VALUES.map((statusValue) => (
                <SelectItem key={statusValue} value={statusValue}>
                  {STATUS_DISPLAY[statusValue].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Input
          value={vacancyInput}
          onChange={(e) => setVacancyInput(e.target.value)}
          onBlur={commitVacancy}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitVacancy();
          }}
          type="number"
          step={1}
          placeholder="Vacancy ="
          aria-label="Vacancy filter"
          className="w-28"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={exportMutation.isPending}
          onClick={() => exportMutation.mutate()}
        >
          {exportMutation.isPending ? "Exporting…" : "Export"}
        </Button>
      </div>

      <div className="rounded-lg border border-border">
        {/* Deliberately NOT the `Table` wrapper component here: it injects its
            own `overflow-x-auto` div around the `<table>`, which forces that
            div's computed overflow-y to `auto` too (CSS's overflow
            visible/non-visible canonicalization rule) -- making IT the nearest
            ancestor scroll container for `sticky` purposes, ahead of the real
            one (AppShell's `<main className="overflow-y-auto">`), even though
            it never actually scrolls itself. Confirmed live (Playwright, this
            exact DOM shape against the app's real compiled CSS): with `Table`,
            the sticky header scrolls away with the rows; with a plain `<table>`
            here, it stays pinned to `<main>`'s top -- and `<main>`'s own
            explicit overflow-y-auto already auto-canonicalizes its own
            overflow-x to `auto` too, so wide tables still scroll horizontally
            within `<main>` rather than overflowing the page (also verified
            live). See a79f9b7/the "remaining hand-rolled tables" merge for the
            first instance of this same root-cause finding. The OTHER `<Table>`
            usage above (the "add row" inline table) has no sticky descendant,
            so it's unaffected and left as-is. */}
        <table className="w-full text-sm">
          <TableHeader className="sticky top-0 z-10 bg-muted">
            <TableRow>
              {/* Leading, unlabeled expand/chevron column. */}
              <TableHead className="w-8" aria-hidden="true" />
              {COLUMNS.map((column) => {
                const isSorted = column.sortBy && sortBy === column.sortBy;
                return (
                  <TableHead
                    key={column.key}
                    sorted={isSorted ? sortDir : false}
                    onSort={column.sortBy ? () => handleSort(column) : undefined}
                  >
                    {column.label}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableEmpty colSpan={TOTAL_COLUMN_COUNT} loading />
            ) : isError ? (
              <TableEmpty colSpan={TOTAL_COLUMN_COUNT} className="text-destructive">
                {error instanceof ApiError ? error.message : "Failed to load the Non-Teaching strength view."}
              </TableEmpty>
            ) : rows.length === 0 ? (
              <TableEmpty colSpan={TOTAL_COLUMN_COUNT}>
                {hasAnyFilter
                  ? "No designations match these filters."
                  : "No sanctioned Non-Teaching designations found."}
              </TableEmpty>
            ) : (
              rows.map((row: NonTeachingStrengthRow) => {
                const statusDisplay = STATUS_DISPLAY[row.status];
                const isExpanded = expandedRowIds.has(row.sanctioned_strength_id);
                const rowLabel = `${row.department_name ?? ""} ${row.designation_name ?? ""}`.trim() || "this row";
                return (
                  <Fragment key={row.sanctioned_strength_id}>
                    <TableRow>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => toggleExpandedRow(row.sanctioned_strength_id)}
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? "Collapse" : "Expand"} employees for ${rowLabel}`}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="h-4 w-4" aria-hidden="true" />
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="font-medium">{row.department_name ?? "—"}</TableCell>
                      <TableCell>{row.designation_name ?? "—"}</TableCell>
                      <TableCell>
                        {row.location_id ? blockByLocationId.get(row.location_id) ?? "—" : "—"}
                      </TableCell>
                      <TableCell>{row.location_name ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{row.approved}</TableCell>
                      <TableCell className="tabular-nums">{row.working}</TableCell>
                      <TableCell className="tabular-nums">{row.vacancy}</TableCell>
                      <TableCell>
                        <Badge variant={statusDisplay.variant}>{statusDisplay.label}</Badge>
                      </TableCell>
                      <TableCell>{formatDate(row.last_join)}</TableCell>
                      <TableCell>{formatDate(row.last_resignation)}</TableCell>
                      <TableCell>{new Date(row.last_updated).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <StrengthRowActions
                          row={row}
                          canManage={canManage}
                          canViewAuditLog={canViewAuditLog}
                          category="NON_TEACHING"
                          onSaved={() =>
                            queryClient.invalidateQueries({ queryKey: ["non-teaching-strength-view"] })
                          }
                        />
                      </TableCell>
                    </TableRow>
                    {isExpanded ? (
                      <EmployeeExpandRow departmentId={row.department_id} designationId={row.designation_id} />
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </table>
      </div>

      <Pagination total={total} limit={limit} offset={offset} onOffsetChange={(next) => setPage(next / limit)} itemLabel="designations" />
    </>
  );
}
