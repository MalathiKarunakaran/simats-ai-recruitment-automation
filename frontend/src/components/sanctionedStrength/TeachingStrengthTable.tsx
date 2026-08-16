import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ChevronsUpDown, Pencil } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { listDepartments } from "@/api/departments";
import { listDesignations } from "@/api/designations";
import { listLocations } from "@/api/locations";
import { getDepartmentSanctionedStrengthBreakdown } from "@/api/sanctionedStrength";
import {
  listTeachingStrengthRows,
  type TeachingStrengthSortBy,
} from "@/api/sanctionedStrengthViews";
import type { CampusRead, TeachingStrengthRow, TeachingStrengthStatus } from "@/api/types";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { DeleteSanctionedStrengthDialog } from "@/components/sanctionedStrength/DeleteSanctionedStrengthDialog";
import { SanctionedStrengthEditPopover } from "@/components/sanctionedStrength/SanctionedStrengthEditPopover";
import { SanctionedStrengthHistoryDrawer } from "@/components/sanctionedStrength/SanctionedStrengthHistoryDrawer";

// Teaching operational view (glowing-zooming-hamming.md Phase E) -- the
// designation-level, every-row-inline table for categoryFilter === "TEACHING"
// on SanctionedStrengthPage. A **new component** rather than repurposing
// SanctionedStrengthPage.tsx's existing department-rollup+expand table body:
// that table's whole shape (one row per *department*, an expand toggle that
// lazily fetches a nested per-designation breakdown table) is the "click to
// discover" structure this phase's decision 1 explicitly replaces for
// Teaching -- there is no expand state, no nested table, and the columns/
// filters/sort fields are a different set entirely (backed by a different
// endpoint, GET /sanctioned-strength/views/teaching, with its own
// TeachingStrengthRow grain). Trying to make one component branch between
// "department rows with an expand toggle" and "flat designation rows with no
// expand" would have meant threading a second, incompatible data shape and
// filter set through every branch of that component for no shared benefit --
// a sibling component, mirroring the backend's own sibling-module split
// (sanctioned_strength_views.py alongside sanctioned_strength.py), keeps
// each table's own concern in its own file. Non-Teaching/Housekeeping still
// render the existing rollup table (their own dedicated views are Phases
// F/G) -- SanctionedStrengthPage.tsx branches on categoryFilter to choose
// between the two.
//
// Phase F (glowing-zooming-hamming.md): the row-actions cluster below
// (`StrengthRowActions`, originally named `TeachingRowActions`) is exported
// and reused verbatim by NonTeachingStrengthTable.tsx -- its Edit/History/
// Delete/"Raise vacancy request" logic never actually inspects `category`,
// it only reads fields both TeachingStrengthRow and NonTeachingStrengthRow
// carry identically (see api/types.ts's own docstring for why those two
// stay separate types rather than one shared type). Renamed from
// `TeachingRowActions` to this category-neutral name at export time, same
// precedent as the backend's own Phase F rename of
// `teaching_strength_status` -> `strength_row_status`
// (app/services/sanctioned_strength_views.py) once a second category
// started using it.

const PAGE_SIZE = 50;

const STATUS_VALUES: TeachingStrengthStatus[] = [
  "VACANCY_RECRUITMENT_REQUIRED",
  "FULLY_STAFFED",
  "OVERSTAFFED",
  "APPROVAL_PENDING",
  "INACTIVE",
];

// Exact label text per app/services/sanctioned_strength_views.py's own
// module docstring ("intended frontend label" comments next to each status
// code) -- not invented wording. Badge variants reuse this codebase's
// existing vocabulary: warning for "needs action soon" (matches
// SanctionedStrengthPage's own VACANCY_EXISTS -> "warning"), success for
// the healthy state, outline for the anomalous OVERSTAFFED state (matches
// SanctionedStrengthPage's own OVERSTAFFED -> "outline"), caution for a
// pending-approval state (matches its own APPROVAL_PENDING -> "caution"),
// destructive for INACTIVE (matches this page's own plain "Inactive" badge
// already used for a deactivated department).
const STATUS_DISPLAY: Record<TeachingStrengthStatus, { label: string; variant: BadgeProps["variant"] }> = {
  VACANCY_RECRUITMENT_REQUIRED: { label: "Vacancy/Recruitment Required", variant: "warning" },
  FULLY_STAFFED: { label: "Fully Staffed", variant: "success" },
  OVERSTAFFED: { label: "Overstaffed", variant: "outline" },
  APPROVAL_PENDING: { label: "Approval Pending", variant: "caution" },
  INACTIVE: { label: "Inactive", variant: "destructive" },
};

interface ColumnDef {
  key: string;
  label: string;
  sortBy?: TeachingStrengthSortBy;
}

const COLUMNS: ColumnDef[] = [
  { key: "campus_code", label: "Campus", sortBy: "campus_code" },
  { key: "department_name", label: "Department", sortBy: "department_name" },
  { key: "designation_name", label: "Designation", sortBy: "designation_name" },
  { key: "location_name", label: "Location", sortBy: "location_name" },
  { key: "approved", label: "Approved", sortBy: "approved" },
  { key: "working", label: "Working", sortBy: "working" },
  { key: "vacancy", label: "Vacancy", sortBy: "vacancy" },
  { key: "filled_pct", label: "Filled %", sortBy: "filled_pct" },
  { key: "status", label: "Status", sortBy: "status" },
  { key: "last_join", label: "Last Join", sortBy: "last_join" },
  { key: "last_resignation", label: "Last Resignation", sortBy: "last_resignation" },
  { key: "last_updated", label: "Last Updated", sortBy: "last_updated" },
  { key: "actions", label: "Actions" },
];

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

// One row's Edit/History/Delete/"Raise vacancy request" cluster --
// TeachingStrengthRow's own shape doesn't carry effective_from/remarks (the
// backend's read-model view never exposes them -- see
// app/services/sanctioned_strength_views.py's docstring for why), so
// SanctionedStrengthEditPopover (which needs both to pre-fill correctly)
// can't be mounted directly off this row. Defaulting them client-side (e.g.
// today's date / blank remarks) would be a real data-loss bug: the popover's
// Save always sends its local effective_from state, which the backend PATCH
// applies unconditionally whenever not None (see
// app/api/v1/routers/sanctioned_strength.py::update_sanctioned_strength) --
// silently overwriting a real historical effective_from with today's date
// the moment a user edits *only* Approved. Instead, this wrapper lazily
// fetches the true DepartmentDesignationBreakdownRow (reusing the existing
// getDepartmentSanctionedStrengthBreakdown endpoint/query key -- shares a
// cache hit with SanctionedStrengthPage's own rollup table if that same
// department happens to already be expanded there) only once the user
// clicks Edit, then mounts the real popover pre-filled with the correct
// values and `autoOpen` so the same click already opens it.
// The subset of fields this component actually reads -- Pick<> off
// TeachingStrengthRow (the single source of truth for these field types)
// rather than a hand-duplicated shape, so this stays structurally
// compatible with both TeachingStrengthRow and NonTeachingStrengthRow
// (identical field shape, see api/types.ts) without importing the latter.
export type StrengthActionRow = Pick<
  TeachingStrengthRow,
  | "sanctioned_strength_id"
  | "campus_id"
  | "department_id"
  | "designation_id"
  | "designation_name"
  | "approved"
  | "working"
  | "vacancy"
>;

export function StrengthRowActions({ row, canManage }: { row: StrengthActionRow; canManage: boolean }) {
  const designationName = row.designation_name ?? "this designation";
  const [detailsRequested, setDetailsRequested] = useState(false);

  const detailsQuery = useQuery({
    queryKey: ["sanctioned-strength-breakdown", row.department_id],
    queryFn: () => getDepartmentSanctionedStrengthBreakdown(row.department_id),
    enabled: detailsRequested,
  });

  const raiseVacancyLink =
    row.vacancy > 0 ? (
      <Link
        to={`/vacancy-requests/new?campus=${row.campus_id}&department=${row.department_id}&designation=${row.designation_id}&maxCount=${row.vacancy}`}
        className="text-xs font-medium text-primary underline-offset-2 hover:underline"
      >
        Raise vacancy request
      </Link>
    ) : null;

  if (!canManage) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="tabular-nums" aria-label={`Approved for ${designationName}`}>
          {row.approved}
        </span>
        <SanctionedStrengthHistoryDrawer
          sanctionedStrengthId={row.sanctioned_strength_id}
          designationName={designationName}
        />
        {raiseVacancyLink}
      </div>
    );
  }

  const breakdownRow = detailsQuery.data?.find((candidate) => candidate.designation_id === row.designation_id);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!detailsRequested ? (
        <>
          <span className="tabular-nums" aria-label={`Approved for ${designationName}`}>
            {row.approved}
          </span>
          <button
            type="button"
            aria-label={`Edit sanctioned strength for ${designationName}`}
            onClick={() => setDetailsRequested(true)}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </>
      ) : detailsQuery.isLoading ? (
        <span className="text-xs text-muted-foreground">Loading…</span>
      ) : detailsQuery.isError ? (
        <span className="text-xs text-destructive">Failed to load edit details.</span>
      ) : (
        <SanctionedStrengthEditPopover
          row={{
            designation_id: row.designation_id,
            designation_name: designationName,
            sanctioned_strength_id: row.sanctioned_strength_id,
            approved: row.approved,
            working: row.working,
            vacancy: row.vacancy,
            effective_from: breakdownRow?.effective_from ?? null,
            remarks: breakdownRow?.remarks ?? null,
          }}
          departmentId={row.department_id}
          campusId={row.campus_id}
          autoOpen
        />
      )}
      <SanctionedStrengthHistoryDrawer
        sanctionedStrengthId={row.sanctioned_strength_id}
        designationName={designationName}
      />
      <DeleteSanctionedStrengthDialog
        sanctionedStrengthId={row.sanctioned_strength_id}
        designationName={designationName}
        departmentId={row.department_id}
      />
      {raiseVacancyLink}
    </div>
  );
}

export interface TeachingStrengthTableProps {
  canManage: boolean;
  canFilterByCampus: boolean;
  campuses: CampusRead[] | undefined;
}

export function TeachingStrengthTable({ canManage, canFilterByCampus, campuses }: TeachingStrengthTableProps) {
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<TeachingStrengthSortBy>("department_name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  const [departmentFilter, setDepartmentFilter] = useState<string>("ALL");
  const [designationFilter, setDesignationFilter] = useState<string>("ALL");
  const [locationFilter, setLocationFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<TeachingStrengthStatus | "ALL">("ALL");
  // Vacancy is an exact-match filter server-side (not a range) -- see
  // api/sanctionedStrengthViews.ts's own docstring -- so this is a plain
  // text/number box, committed on blur/Enter same as the search box (a
  // server-side filter, unlike a client-filtered one).
  const [vacancyInput, setVacancyInput] = useState("");
  const [vacancyFilter, setVacancyFilter] = useState<number | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: listDepartments });
  const { data: designations } = useQuery({
    queryKey: ["designations", "TEACHING"],
    queryFn: () => listDesignations({ category: "TEACHING" }),
  });
  const { data: locations } = useQuery({ queryKey: ["locations"], queryFn: listLocations });

  const teachingDepartments = (departments ?? []).filter((department) => department.category === "TEACHING");
  // Location.category is nullable (a building can serve multiple
  // categories, per this epic's plan) -- offered here whenever it's either
  // unset or explicitly TEACHING, never for a Location scoped to a
  // different single category.
  const teachingLocations = (locations ?? []).filter(
    (location) => location.category === null || location.category === "TEACHING",
  );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "teaching-strength-view",
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
      listTeachingStrengthRows({
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
  const offset = data?.offset ?? page * PAGE_SIZE;
  const limit = data?.limit ?? PAGE_SIZE;
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + limit, total);

  return (
    <>
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
              {teachingDepartments.map((department) => (
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
              {teachingLocations.map((location) => (
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
            onValueChange={(v) => { setStatusFilter(v as TeachingStrengthStatus | "ALL"); setPage(0); }}
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
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr className="text-left text-muted-foreground">
              {COLUMNS.map((column) => {
                const isSorted = column.sortBy && sortBy === column.sortBy;
                const ariaSort: "ascending" | "descending" | "none" = isSorted
                  ? sortDir === "asc"
                    ? "ascending"
                    : "descending"
                  : "none";
                return (
                  <th
                    key={column.key}
                    className="px-3 py-2 text-table-header font-medium"
                    aria-sort={column.sortBy ? ariaSort : undefined}
                  >
                    {column.sortBy ? (
                      <button
                        type="button"
                        onClick={() => handleSort(column)}
                        className={cn(
                          "flex items-center gap-1 transition-colors hover:text-foreground",
                          isSorted && "text-foreground",
                        )}
                      >
                        {column.label}
                        {isSorted ? (
                          sortDir === "asc" ? (
                            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-4 text-sm text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-4 text-sm text-destructive">
                  {error instanceof ApiError ? error.message : "Failed to load the Teaching strength view."}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-4 text-sm text-muted-foreground">
                  {hasAnyFilter ? "No designations match these filters." : "No sanctioned Teaching designations found."}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const statusDisplay = STATUS_DISPLAY[row.status];
                return (
                  <tr key={row.sanctioned_strength_id} className="transition-colors hover:bg-accent/50">
                    <td className="px-3 py-2">{row.campus_code ?? "—"}</td>
                    <td className="px-3 py-2 font-medium">{row.department_name ?? "—"}</td>
                    <td className="px-3 py-2">{row.designation_name ?? "—"}</td>
                    <td className="px-3 py-2">{row.location_name ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{row.approved}</td>
                    <td className="px-3 py-2 tabular-nums">{row.working}</td>
                    <td className="px-3 py-2 tabular-nums">{row.vacancy}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <span className="tabular-nums">{row.filled_pct !== null ? `${row.filled_pct}%` : "—"}</span>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-[width] duration-300"
                            style={{ width: `${Math.min(row.filled_pct ?? 0, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={statusDisplay.variant}>{statusDisplay.label}</Badge>
                    </td>
                    <td className="px-3 py-2">{formatDate(row.last_join)}</td>
                    <td className="px-3 py-2">{formatDate(row.last_resignation)}</td>
                    <td className="px-3 py-2">{new Date(row.last_updated).toLocaleDateString()}</td>
                    <td className="px-3 py-2">
                      <StrengthRowActions row={row} canManage={canManage} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Showing {showingFrom}–{showingTo} of {total} designations
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + limit >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </>
  );
}
