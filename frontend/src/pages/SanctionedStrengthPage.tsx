import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown } from "lucide-react";
import { Fragment, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { listCampuses } from "@/api/campuses";
import { ApiError } from "@/api/client";
import {
  getDepartmentSanctionedStrengthBreakdown,
  listSanctionedStrengthRegister,
  type SanctionedStrengthSortBy,
  type SortDirection,
} from "@/api/sanctionedStrength";
import {
  GLOBAL_SCOPE_ROLES,
  SANCTIONED_STRENGTH_WRITE_ROLES,
  type ApprovalStatus,
  type DepartmentDesignationBreakdownRow,
  type RecruitmentStatus,
  type StaffRoleCategory,
} from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { AddDesignationRow } from "@/components/sanctionedStrength/AddDesignationRow";
import { BulkUploadDialog } from "@/components/sanctionedStrength/BulkUploadDialog";
import { DeleteSanctionedStrengthDialog } from "@/components/sanctionedStrength/DeleteSanctionedStrengthDialog";
import { NonTeachingStrengthTable } from "@/components/sanctionedStrength/NonTeachingStrengthTable";
import { SanctionedStrengthEditPopover } from "@/components/sanctionedStrength/SanctionedStrengthEditPopover";
import { SanctionedStrengthHistoryDrawer } from "@/components/sanctionedStrength/SanctionedStrengthHistoryDrawer";
import { TeachingStrengthTable } from "@/components/sanctionedStrength/TeachingStrengthTable";
import { UploadHistoryTab } from "@/components/sanctionedStrength/UploadHistoryTab";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { CategoryTabs, mapServerCategoryCounts } from "@/components/domain/CategoryTabs";
import { useCategoryTabState } from "@/hooks/useCategoryTabState";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

const APPROVAL_STATUSES: ApprovalStatus[] = ["APPROVAL_PENDING", "REJECTED", "APPROVED", "NO_REQUESTS"];
const RECRUITMENT_STATUSES: RecruitmentStatus[] = ["FULLY_STAFFED", "VACANCY_EXISTS", "OVERSTAFFED", "NO_ACTIVITY"];

interface ColumnDef {
  key: string;
  label: string;
  // Only sortable columns carry a sort_by value -- the two status columns
  // aren't in the backend's SORT_FIELDS, so they render as plain (non-
  // clickable) headers.
  sortBy?: SanctionedStrengthSortBy;
}

// +1 for the leading expand/chevron column, which carries no header label.
const COLUMNS: ColumnDef[] = [
  { key: "department_name", label: "Department", sortBy: "department_name" },
  { key: "category", label: "Category", sortBy: "category" },
  { key: "approved_count", label: "Approved", sortBy: "approved_count" },
  { key: "working_count", label: "Working", sortBy: "working_count" },
  { key: "vacancy_count", label: "Vacancy", sortBy: "vacancy_count" },
  { key: "filled_pct", label: "Filled %", sortBy: "filled_pct" },
  { key: "recruitment_status", label: "Recruitment Status" },
  { key: "approval_status", label: "Approval Status" },
  { key: "last_join", label: "Last Join", sortBy: "last_join" },
  { key: "last_resignation", label: "Last Resignation", sortBy: "last_resignation" },
  { key: "last_updated", label: "Last Updated", sortBy: "last_updated" },
];
const TOTAL_COLUMN_COUNT = COLUMNS.length + 1;

const RECRUITMENT_STATUS_DISPLAY: Record<RecruitmentStatus, { label: string; variant: BadgeProps["variant"] }> = {
  FULLY_STAFFED: { label: "Fully Staffed", variant: "success" },
  VACANCY_EXISTS: { label: "Vacancy Exists", variant: "warning" },
  OVERSTAFFED: { label: "Overstaffed", variant: "outline" },
  NO_ACTIVITY: { label: "No Activity", variant: "default" },
};

const APPROVAL_STATUS_DISPLAY: Record<ApprovalStatus, { label: string; variant: BadgeProps["variant"] }> = {
  APPROVAL_PENDING: { label: "Approval Pending", variant: "caution" },
  REJECTED: { label: "Rejected", variant: "destructive" },
  APPROVED: { label: "Approved", variant: "success" },
  NO_REQUESTS: { label: "No Requests", variant: "default" },
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

// One designation's row within an expanded department's breakdown table --
// split out from DepartmentBreakdownRow so it can be a clean per-row
// component (a plain .map() body can't call hooks per iteration). The
// approved/effective_from/remarks edit affordance itself (including the
// create-vs-update POST/PATCH branch) lives in SanctionedStrengthEditPopover.
function DesignationRow({
  row,
  departmentId,
  campusId,
  canManage,
}: {
  row: DepartmentDesignationBreakdownRow;
  departmentId: string;
  campusId: string;
  canManage: boolean;
}) {
  return (
    <tr>
      <td className="px-3 py-1.5">{row.designation_name}</td>
      <td className="px-3 py-1.5">
        <SanctionedStrengthEditPopover
          row={row}
          departmentId={departmentId}
          campusId={campusId}
          readOnly={!canManage}
        />
      </td>
      <td className="px-3 py-1.5 tabular-nums">{row.working}</td>
      <td className="px-3 py-1.5 tabular-nums">{row.vacancy}</td>
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          {row.sanctioned_strength_id ? (
            <>
              <SanctionedStrengthHistoryDrawer
                sanctionedStrengthId={row.sanctioned_strength_id}
                designationName={row.designation_name}
              />
              {canManage ? (
                <DeleteSanctionedStrengthDialog
                  sanctionedStrengthId={row.sanctioned_strength_id}
                  designationName={row.designation_name}
                  departmentId={departmentId}
                />
              ) : null}
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Not yet sanctioned</span>
          )}
          {/* Phase E item 30: only offered where there's actually something
              vacant to request against -- `maxCount` is a client-side cap
              only, the real ceiling is still enforced server-side by
              submit()'s own "Only N posts available to request" 409. */}
          {row.vacancy > 0 ? (
            <Link
              to={`/vacancy-requests/new?campus=${campusId}&department=${departmentId}&designation=${row.designation_id}&maxCount=${row.vacancy}`}
              className="text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              Raise vacancy request
            </Link>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

// Nested breakdown table for one expanded department row -- only mounted
// (and so only fetched) while that department is expanded; collapsing
// unmounts it rather than merely hiding it, so re-expanding the same
// department later fires a fresh fetch (React Query's cache still saves a
// round trip within its default staleTime).
function DepartmentBreakdownRow({
  departmentId,
  campusId,
  category,
  canManage,
}: {
  departmentId: string;
  campusId: string;
  category: string | null;
  canManage: boolean;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["sanctioned-strength-breakdown", departmentId],
    queryFn: () => getDepartmentSanctionedStrengthBreakdown(departmentId),
  });

  const BREAKDOWN_COLUMN_COUNT = 5;

  return (
    <tr className="bg-muted/40">
      <td colSpan={TOTAL_COLUMN_COUNT} className="px-3 py-3">
        {isLoading ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">Loading designation breakdown…</p>
        ) : isError ? (
          <p className="px-3 py-2 text-sm text-destructive">Failed to load the designation breakdown.</p>
        ) : !data || data.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">No designations linked to this department.</p>
        ) : (
          <table className="w-full max-w-3xl text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-1.5 text-table-header font-medium">Designation</th>
                <th className="px-3 py-1.5 text-table-header font-medium">Approved</th>
                <th className="px-3 py-1.5 text-table-header font-medium">Working</th>
                <th className="px-3 py-1.5 text-table-header font-medium">Vacancy</th>
                <th className="px-3 py-1.5 text-table-header font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((row) => (
                <DesignationRow
                  key={row.designation_id}
                  row={row}
                  departmentId={departmentId}
                  campusId={campusId}
                  canManage={canManage}
                />
              ))}
              {canManage ? (
                <AddDesignationRow
                  departmentId={departmentId}
                  campusId={campusId}
                  category={category as StaffRoleCategory | null}
                  excludeDesignationIds={data.map((row) => row.designation_id)}
                  columnCount={BREAKDOWN_COLUMN_COUNT}
                />
              ) : null}
            </tbody>
          </table>
        )}
      </td>
    </tr>
  );
}

export function SanctionedStrengthPage() {
  const { user } = useAuth();
  // Phase E item 29's reverse link -- VacancyRequestDetailPage links here
  // as ?department=X&designation=Y. Only the department id drives the
  // expand-state addition below (designation isn't its own row/section to
  // expand to, it's a row *within* the expanded breakdown table) -- read
  // once on mount, same as this page's other URL-persisted state
  // (useCategoryTabState) but a plain one-off read here, not a synced hook.
  const [searchParams] = useSearchParams();
  const deepLinkDepartmentId = searchParams.get("department");
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<SanctionedStrengthSortBy>("department_name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  // URL-persisted via ?category=... (see hooks/useCategoryTabState.ts) so
  // the selection survives refresh/back-forward/shared links. Defaults to
  // TEACHING (glowing-zooming-hamming.md Phase E's default-tab fix) --
  // Teaching now has its own dedicated operational view (TeachingStrengthTable,
  // below) and is this page's most-used tab, so landing on it directly
  // avoids an extra click on every visit. The hook's own default stays "ALL"
  // for every other of its 8+ call sites -- this is a page-local override via
  // the hook's new optional defaultValue param, not a change to the hook's
  // own default (see useCategoryTabState.ts's docstring).
  const [categoryFilter, setCategoryFilter] = useCategoryTabState("category", "TEACHING");
  const [approvalStatusFilter, setApprovalStatusFilter] = useState<ApprovalStatus | "ALL">("ALL");
  const [recruitmentStatusFilter, setRecruitmentStatusFilter] = useState<RecruitmentStatus | "ALL">("ALL");
  // Defaults to Active-only -- inactive/deactivated departments shouldn't
  // clutter this register by default, same convention as Departments/
  // Eligibility Rules. Unlike those two pages (which filter client-side over
  // an already-fetched full list), this is a real server-side query param,
  // since the backend computes each row's aggregates as an expensive
  // correlated subquery -- filtering before that computation, not after.
  const [activeFilter, setActiveFilter] = useState<"ALL" | "true" | "false">("true");
  // searchInput tracks every keystroke; search (the value actually sent to
  // the server) only updates on blur/Enter -- this is a server-side filter
  // (unlike the client-side-filtered search boxes on Departments/Employees/
  // etc.), so committing on every keystroke would fire a request per key.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // Which department rows currently show their designation-level breakdown
  // -- a plain id set, not a single "expandedId" like VacancyRequestsListPage
  // (there's no accordion-per-group nesting here to also collapse). Seeded
  // with the deep-linked department (if any) so the reverse link from
  // VacancyRequestDetailPage lands with that row already open.
  const [expandedDepartmentIds, setExpandedDepartmentIds] = useState<Set<string>>(
    () => new Set(deepLinkDepartmentId ? [deepLinkDepartmentId] : []),
  );
  // Page-section switcher (zany-snuggling-pie.md Phase F, item 2) -- the
  // first use of components/ui/tabs.tsx's Tabs as a section switcher rather
  // than a category filter (CategoryTabs above is still the latter). Local
  // state only, not URL-persisted (unlike categoryFilter) -- no other page
  // in this codebase deep-links into a specific section this way yet.
  const [section, setSection] = useState<"register" | "history">("register");

  // A single-campus role's campus_code is always ignored server-side (see
  // resolve_campus_filter) -- only global-scope roles get a working filter.
  const canFilterByCampus = Boolean(user && GLOBAL_SCOPE_ROLES.includes(user.role));
  // Mirrors app/api/v1/routers/sanctioned_strength.py's write-role gate --
  // gates the breakdown's inline edit / add designation / soft-delete
  // affordances (Phase D). The history drawer trigger is deliberately not
  // gated by this -- it's read-only, same as the backend's own history
  // endpoint (staff-only, not write-role-only).
  const canManage = Boolean(user && SANCTIONED_STRENGTH_WRITE_ROLES.includes(user.role));
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses, enabled: canFilterByCampus });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "sanctioned-strength-register",
      page,
      sortBy,
      sortDir,
      campusFilter,
      categoryFilter,
      approvalStatusFilter,
      recruitmentStatusFilter,
      activeFilter,
      search,
    ],
    queryFn: () =>
      listSanctionedStrengthRegister({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        sort_by: sortBy,
        sort_dir: sortDir,
        campus_code: campusFilter === "ALL" ? null : campusFilter,
        category: categoryFilter === "ALL" ? null : categoryFilter,
        approval_status: approvalStatusFilter === "ALL" ? null : approvalStatusFilter,
        recruitment_status: recruitmentStatusFilter === "ALL" ? null : recruitmentStatusFilter,
        is_active: activeFilter === "ALL" ? null : activeFilter === "true",
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

  function toggleExpandedDepartment(departmentId: string) {
    setExpandedDepartmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(departmentId)) next.delete(departmentId);
      else next.add(departmentId);
      return next;
    });
  }

  const hasAnyFilter =
    campusFilter !== "ALL" ||
    categoryFilter !== "ALL" ||
    approvalStatusFilter !== "ALL" ||
    recruitmentStatusFilter !== "ALL" ||
    activeFilter !== "true" ||
    search.trim() !== "";

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const offset = data?.offset ?? page * PAGE_SIZE;
  const limit = data?.limit ?? PAGE_SIZE;
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + limit, total);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sanctioned Strength"
        description="Sanctioned vs working strength per department. This defines how many posts may be requested."
        // Phase F item 1: "Bulk upload" entry point, gated to the same
        // canManage (SANCTIONED_STRENGTH_WRITE_ROLES) check as every other
        // write affordance on this page -- the backend's own bulk-upload
        // endpoints are gated identically (_write_only in
        // sanctioned_strength.py).
        actions={canManage ? <BulkUploadDialog /> : undefined}
      />

      {canManage ? (
        <Tabs
          value={section}
          onValueChange={setSection}
          tabs={[
            { value: "register" as const, label: "Sanctioned Strength" },
            { value: "history" as const, label: "Upload history" },
          ]}
        />
      ) : null}

      {section === "history" && canManage ? (
        <UploadHistoryTab />
      ) : (
        <>
          <CategoryTabs
            value={categoryFilter}
            onValueChange={(v) => {
              setCategoryFilter(v);
              setPage(0);
            }}
            counts={mapServerCategoryCounts(data?.category_counts)}
          />

          {categoryFilter === "TEACHING" ? (
            // Teaching's own operational view (Phase E) -- designation-level
            // rows, every row inline, no expand. Non-Teaching/Housekeeping/All
            // keep the existing department-rollup+expand table below (their
            // own dedicated views are Phases F/G) -- this branch is the only
            // thing that changes behavior for those tabs versus before this
            // phase; the register query above still runs regardless of tab
            // (CategoryTabs' own counts need it), it's just not rendered as a
            // table body while on the Teaching tab.
            <TeachingStrengthTable canManage={canManage} canFilterByCampus={canFilterByCampus} campuses={campuses} />
          ) : categoryFilter === "NON_TEACHING" ? (
            // Non-Teaching's own operational view (Phase F, glowing-zooming-
            // hamming.md) -- same designation-level-rows-with-no-department-
            // expand shape as Teaching's table, plus its own expand-to-
            // employees affordance (see NonTeachingStrengthTable's own
            // docstring). Housekeeping/All still fall through to the
            // pre-existing department-rollup+expand table below (Housekeeping's
            // own dedicated view is Phase G's job, and "All" spans every
            // category so it isn't a single designation-level grain to begin
            // with).
            <NonTeachingStrengthTable canManage={canManage} canFilterByCampus={canFilterByCampus} campuses={campuses} />
          ) : (
            <>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onBlur={commitSearch}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitSearch();
              }}
              placeholder="Search department or employee"
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
              <Select
                value={approvalStatusFilter}
                onValueChange={(v) => { setApprovalStatusFilter(v as ApprovalStatus | "ALL"); setPage(0); }}
              >
                <SelectTrigger aria-label="Approval status filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All approval statuses</SelectItem>
                  {APPROVAL_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {APPROVAL_STATUS_DISPLAY[status].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-48">
              <Select
                value={recruitmentStatusFilter}
                onValueChange={(v) => { setRecruitmentStatusFilter(v as RecruitmentStatus | "ALL"); setPage(0); }}
              >
                <SelectTrigger aria-label="Recruitment status filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All recruitment statuses</SelectItem>
                  {RECRUITMENT_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {RECRUITMENT_STATUS_DISPLAY[status].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-40">
              <Select value={activeFilter} onValueChange={(v) => { setActiveFilter(v as "ALL" | "true" | "false"); setPage(0); }}>
                <SelectTrigger aria-label="Active filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All statuses</SelectItem>
                  <SelectItem value="true">Active</SelectItem>
                  <SelectItem value="false">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted">
                <tr className="text-left text-muted-foreground">
                  {/* Leading, unlabeled expand/chevron column. */}
                  <th className="w-8 px-3 py-2" aria-hidden="true" />
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
                    <td colSpan={TOTAL_COLUMN_COUNT} className="px-3 py-4 text-sm text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                ) : isError ? (
                  <tr>
                    <td colSpan={TOTAL_COLUMN_COUNT} className="px-3 py-4 text-sm text-destructive">
                      {error instanceof ApiError ? error.message : "Failed to load sanctioned strength."}
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={TOTAL_COLUMN_COUNT} className="px-3 py-4 text-sm text-muted-foreground">
                      {hasAnyFilter ? "No departments match these filters." : "No departments found."}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const recruitmentDisplay = RECRUITMENT_STATUS_DISPLAY[row.recruitment_status];
                    const approvalDisplay = APPROVAL_STATUS_DISPLAY[row.approval_status];
                    const isExpanded = expandedDepartmentIds.has(row.department_id);
                    return (
                      <Fragment key={row.department_id}>
                        <tr className="transition-colors hover:bg-accent/50">
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => toggleExpandedDepartment(row.department_id)}
                              aria-expanded={isExpanded}
                              aria-label={`${isExpanded ? "Collapse" : "Expand"} ${row.department_name} designation breakdown`}
                              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" aria-hidden="true" />
                              ) : (
                                <ChevronRight className="h-4 w-4" aria-hidden="true" />
                              )}
                            </button>
                          </td>
                          <td className="px-3 py-2 font-medium">
                            <button
                              type="button"
                              onClick={() => toggleExpandedDepartment(row.department_id)}
                              className="flex items-center gap-2 text-left"
                            >
                              {row.department_name}
                              {!row.is_active ? <Badge variant="destructive">Inactive</Badge> : null}
                            </button>
                          </td>
                          <td className="px-3 py-2">{row.category ? row.category.replace(/_/g, " ") : "—"}</td>
                          <td className="px-3 py-2 tabular-nums">{row.approved_count}</td>
                          <td className="px-3 py-2 tabular-nums">{row.working_count}</td>
                          <td className="px-3 py-2 tabular-nums">{row.vacancy_count}</td>
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
                            {/* Phase E item 28: clickable through to the requests
                                that produced this status -- department-level
                                only (no single designation to filter by here;
                                that granularity is item 30's per-designation
                                "Raise vacancy request" action above, and item
                                29's reverse link, both of which do carry a
                                designation param). Count is the same
                                *_request_count field VacancyRegisterRow already
                                carries (Phase B). */}
                            <Link to={`/vacancy-requests?department=${row.department_id}`}>
                              <Badge variant={recruitmentDisplay.variant}>
                                {recruitmentDisplay.label} ({row.recruitment_status_request_count})
                              </Badge>
                            </Link>
                          </td>
                          <td className="px-3 py-2">
                            <Link to={`/vacancy-requests?department=${row.department_id}`}>
                              <Badge variant={approvalDisplay.variant}>
                                {approvalDisplay.label} ({row.approval_status_request_count})
                              </Badge>
                            </Link>
                          </td>
                          <td className="px-3 py-2">{formatDate(row.last_join)}</td>
                          <td className="px-3 py-2">{formatDate(row.last_resignation)}</td>
                          <td className="px-3 py-2">{new Date(row.last_updated).toLocaleDateString()}</td>
                        </tr>
                        {isExpanded ? (
                          <DepartmentBreakdownRow
                            departmentId={row.department_id}
                            campusId={row.campus_id}
                            category={row.category}
                            canManage={canManage}
                          />
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Showing {showingFrom}–{showingTo} of {total} departments
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
          )}
        </>
      )}
    </div>
  );
}
