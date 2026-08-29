import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";

import { ApiError } from "@/api/client";
import { listDesignations } from "@/api/designations";
import { deleteHousekeepingStaff, listHousekeepingStaffByLocation } from "@/api/housekeepingStaff";
import { listLocations } from "@/api/locations";
import {
  listHousekeepingStrengthRows,
  type HousekeepingStrengthSortBy,
  exportStrengthView,
} from "@/api/sanctionedStrengthViews";
import type {
  CampusRead,
  HousekeepingShift,
  HousekeepingStaffRead,
  HousekeepingStrengthRow,
  HousekeepingStrengthStatus,
} from "@/api/types";
import { DeleteConfirmDialog } from "@/components/domain/DeleteConfirmDialog";
import { HousekeepingStaffFormDrawer } from "@/components/housekeepingStaff/HousekeepingStaffFormDrawer";
import { StrengthKpiSummary } from "@/components/sanctionedStrength/StrengthKpiSummary";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Housekeeping operational view (glowing-zooming-hamming.md Phase G) -- the
// Location-grained, every-row-inline table for categoryFilter ===
// "HOUSEKEEPING" on SanctionedStrengthPage. Structurally the third sibling
// of TeachingStrengthTable/NonTeachingStrengthTable (same filters/sort/
// pagination shape, same GET /sanctioned-strength/views/* family), but with
// two deliberate, larger divergences than Non-Teaching's own two (see that
// component's own docstring) -- both are judgment calls this phase resolved,
// documented here rather than left implicit:
//
// 1. Row grain and column set are genuinely different, not just narrower.
//    HousekeepingStrengthRow (api/types.ts) carries NO department_id/
//    department_name/designation_id/designation_name/sanctioned_strength_id
//    at all -- a single row can aggregate more than one current-effective
//    HOUSEKEEPING SanctionedStrength record at the same Location (see
//    app/services/sanctioned_strength_views.py's own module docstring,
//    Phase G section). So this table's own column set
//    (Location/Block/Floor-Venue/Required/Available/Vacancy/Shift/Status/
//    Actions) never renders a Department or Designation column -- there is
//    no single one of either to show. `StrengthRowActions`
//    (TeachingStrengthTable.tsx) is NOT reused here for exactly this reason:
//    every one of its actions (Edit/History/Delete/"Raise vacancy request")
//    targets one specific `sanctioned_strength_id`, which this aggregate
//    grain doesn't have.
// 2. Actions column is a completely different action, not the same cluster
//    narrowed. There is no per-row "Edit Required"/History/Delete/"Raise
//    vacancy request" affordance in this phase at all -- per
//    app/services/sanctioned_strength_views.py's own Phase G judgment call
//    #6, a unified "edit sanctioned strength for this row" action is Phase
//    H's job (the shared drawer), not this one's. The only per-row action
//    this phase ships is "Add staff" -- opens HousekeepingStaffFormDrawer in
//    create mode, pre-filled to this row's own location_id/campus_id via
//    that component's new initialLocationId/initialCampusId props (see its
//    own docstring) -- there is nothing else meaningful to offer at this
//    grain without a real per-row sanctioned-strength id to target.
//    canManage here mirrors app/api/v1/routers/housekeeping_staff.py's own
//    `_WRITE_ROLES` (HOUSEKEEPING_STAFF_MANAGEMENT_ROLES) -- a genuinely
//    different role gate than TeachingStrengthTable/NonTeachingStrengthTable's
//    own `canManage` (SANCTIONED_STRENGTH_WRITE_ROLES), since every mutation
//    this table's Actions column and roster expand row can trigger
//    (create/update/delete HousekeepingStaff) is a HousekeepingStaff write,
//    never a SanctionedStrength write -- SanctionedStrengthPage.tsx computes
//    and passes this table its own canManage value accordingly, distinct
//    from the one it passes the other two tables.
//
// Expand-to-roster (leading chevron column) follows the same lazy-fetch-
// only-while-expanded shape as NonTeachingStrengthTable's own
// EmployeeExpandRow, but fetches this row's *HousekeepingStaff* roster (via
// the new listHousekeepingStaffByLocation(), a real GET /housekeeping-staff
// ?location_id=... call -- Phase D's existing endpoint, not mock data) with
// its own richer shape (Bio ID/Name/Designation/Shift/Supervisor/Status),
// not Employees -- HousekeepingStaff is this category's own occupancy table
// (plan decision 3). Each roster row gets an inline Edit (reuses
// HousekeepingStaffFormDrawer in edit mode) and Delete (DeleteConfirmDialog +
// deleteHousekeepingStaff) -- the exact same components
// HousekeepingStaffListPage.tsx already uses for its own roster CRUD, not a
// new implementation.

const PAGE_SIZE = 50;

const STATUS_VALUES: HousekeepingStrengthStatus[] = [
  "VACANCY_RECRUITMENT_REQUIRED",
  "FULLY_STAFFED",
  "OVERSTAFFED",
  "APPROVAL_PENDING",
  "INACTIVE",
];

// Same label/variant mapping as Teaching/Non-Teaching's own STATUS_DISPLAY
// -- the status vocabulary is genuinely shared (see
// app/services/sanctioned_strength_views.py's own docstring) -- deliberate
// small duplication, matching this codebase's existing precedent (see the
// other two tables' own comments on this same choice).
const STATUS_DISPLAY: Record<HousekeepingStrengthStatus, { label: string; variant: BadgeProps["variant"] }> = {
  VACANCY_RECRUITMENT_REQUIRED: { label: "Vacancy/Recruitment Required", variant: "warning" },
  FULLY_STAFFED: { label: "Fully Staffed", variant: "success" },
  OVERSTAFFED: { label: "Overstaffed", variant: "outline" },
  APPROVAL_PENDING: { label: "Approval Pending", variant: "caution" },
  INACTIVE: { label: "Inactive", variant: "destructive" },
};

const SHIFT_VALUES: HousekeepingShift[] = ["MORNING", "AFTERNOON", "EVENING", "NIGHT"];

const SHIFT_LABELS: Record<string, string> = {
  MORNING: "Morning",
  AFTERNOON: "Afternoon",
  EVENING: "Evening",
  NIGHT: "Night",
};

interface ColumnDef {
  key: string;
  label: string;
  sortBy?: HousekeepingStrengthSortBy;
}

// No Department/Designation column, ever -- this row's grain has neither
// (see this component's own docstring, item 1).
const COLUMNS: ColumnDef[] = [
  { key: "location_name", label: "Location", sortBy: "location_name" },
  { key: "block", label: "Block", sortBy: "block" },
  { key: "floor_venue", label: "Floor / Venue", sortBy: "floor_venue" },
  { key: "required", label: "Required", sortBy: "required" },
  { key: "available", label: "Available", sortBy: "available" },
  { key: "vacancy", label: "Vacancy", sortBy: "vacancy" },
  { key: "shift", label: "Shift" },
  { key: "status", label: "Status", sortBy: "status" },
  { key: "actions", label: "Actions" },
];
// +1 for the leading expand/chevron column, which carries no header label.
const TOTAL_COLUMN_COUNT = COLUMNS.length + 1;

function statusLabel(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

// One expanded row's live HousekeepingStaff roster for that location --
// lazily fetched (only mounted while that row is expanded) via the new
// listHousekeepingStaffByLocation(location_id) call, a real GET
// /housekeeping-staff?location_id=... request (Phase D's existing endpoint),
// never mock data. Each roster entry gets its own inline Edit/Delete,
// reusing HousekeepingStaffFormDrawer/DeleteConfirmDialog +
// deleteHousekeepingStaff exactly as HousekeepingStaffListPage.tsx does.
function RosterExpandRow({
  locationId,
  canManage,
  onEdit,
  designationById,
}: {
  locationId: string;
  canManage: boolean;
  onEdit: (record: HousekeepingStaffRead) => void;
  designationById: Map<string, string>;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["housekeeping-staff-by-location", locationId],
    queryFn: () => listHousekeepingStaffByLocation(locationId),
  });

  function afterRosterChange() {
    void queryClient.invalidateQueries({ queryKey: ["housekeeping-staff-by-location", locationId] });
    // Available/Vacancy/Shift/Status all derive from the live roster --
    // invalidate every cached page of the strength view too, not just this
    // location's own roster slice.
    void queryClient.invalidateQueries({ queryKey: ["housekeeping-strength-view"] });
  }

  return (
    <tr className="bg-muted/40">
      <td colSpan={TOTAL_COLUMN_COUNT} className="px-3 py-3">
        {isLoading ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">Loading roster…</p>
        ) : isError ? (
          <p className="px-3 py-2 text-sm text-destructive">Failed to load the roster for this location.</p>
        ) : !data || data.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">No housekeeping staff currently at this location.</p>
        ) : (
          <div className="max-w-3xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="py-1.5">Bio ID</TableHead>
                  <TableHead className="py-1.5">Name</TableHead>
                  <TableHead className="py-1.5">Designation</TableHead>
                  <TableHead className="py-1.5">Shift</TableHead>
                  <TableHead className="py-1.5">Supervisor</TableHead>
                  <TableHead className="py-1.5">Status</TableHead>
                  {canManage ? <TableHead className="py-1.5">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((staff) => (
                  <TableRow key={staff.id}>
                    <TableCell className="py-1.5 font-mono text-xs">{staff.bio_id}</TableCell>
                    <TableCell className="py-1.5">{staff.name}</TableCell>
                    <TableCell className="py-1.5">{designationById.get(staff.designation_id) ?? "—"}</TableCell>
                    <TableCell className="py-1.5">{SHIFT_LABELS[staff.shift] ?? staff.shift}</TableCell>
                    <TableCell className="py-1.5">{staff.supervisor ?? "—"}</TableCell>
                    <TableCell className="py-1.5">
                      <Badge variant={staff.is_active ? "success" : "destructive"}>
                        {staff.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    {canManage ? (
                      <TableCell className="py-1.5">
                        <div className="flex items-center gap-1.5">
                          <Button variant="outline" size="sm" onClick={() => onEdit(staff)}>
                            Edit
                          </Button>
                          <DeleteConfirmDialog
                            triggerAriaLabel={`Delete housekeeping staff ${staff.name}`}
                            title="Delete housekeeping staff"
                            description={
                              <>
                                Remove <span className="font-medium text-foreground">{staff.name}</span>? This is a
                                soft delete -- the record stays visible (as Inactive) and can be reactivated later.
                              </>
                            }
                            onDelete={() => deleteHousekeepingStaff(staff.id)}
                            onDeleted={afterRosterChange}
                          />
                        </div>
                      </TableCell>
                    ) : null}
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

export interface HousekeepingStrengthTableProps {
  /** Mirrors app/api/v1/routers/housekeeping_staff.py's own `_WRITE_ROLES`
   * (HOUSEKEEPING_STAFF_MANAGEMENT_ROLES) -- deliberately NOT the same
   * canManage value SanctionedStrengthPage.tsx passes to Teaching/
   * Non-Teaching's tables (SANCTIONED_STRENGTH_WRITE_ROLES); see this
   * file's own docstring, item 2. */
  canManage: boolean;
  canFilterByCampus: boolean;
  campuses: CampusRead[] | undefined;
}

export function HousekeepingStrengthTable({ canManage, canFilterByCampus, campuses }: HousekeepingStrengthTableProps) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<HousekeepingStrengthSortBy>("location_name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  const [locationFilter, setLocationFilter] = useState<string>("ALL");
  const [blockFilter, setBlockFilter] = useState("");
  const [blockCommitted, setBlockCommitted] = useState("");
  // Real live gap found and fixed (2026-08-17): floor_venue was already a
  // real column on this table but had no matching filter, unlike block --
  // same committed-on-blur/Enter text-filter shape as blockFilter above.
  const [floorVenueFilter, setFloorVenueFilter] = useState("");
  const [floorVenueCommitted, setFloorVenueCommitted] = useState("");
  const [shiftFilter, setShiftFilter] = useState<HousekeepingShift | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<HousekeepingStrengthStatus | "ALL">("ALL");
  const [vacancyInput, setVacancyInput] = useState("");
  const [vacancyFilter, setVacancyFilter] = useState<number | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [expandedLocationIds, setExpandedLocationIds] = useState<Set<string>>(() => new Set());

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<HousekeepingStaffRead | null>(null);
  const [prefillLocationId, setPrefillLocationId] = useState<string | undefined>(undefined);
  const [prefillCampusId, setPrefillCampusId] = useState<string | undefined>(undefined);

  const { data: locations } = useQuery({ queryKey: ["locations"], queryFn: listLocations });
  // Location.category is nullable (a building can serve multiple
  // categories) -- offered whenever it's either unset or explicitly
  // HOUSEKEEPING, same convention as Teaching/Non-Teaching's own location
  // filtering.
  const housekeepingLocations = (locations ?? []).filter(
    (location) => location.category === null || location.category === "HOUSEKEEPING",
  );
  // Resolves each roster entry's designation_id to a display name in
  // RosterExpandRow below -- HousekeepingStaffRead only carries the raw id
  // (same shape as HousekeepingStaffListPage.tsx's own designationById map).
  const { data: designations } = useQuery({
    queryKey: ["designations", "HOUSEKEEPING"],
    queryFn: () => listDesignations({ category: "HOUSEKEEPING" }),
  });
  const designationById = new Map((designations ?? []).map((d) => [d.id, d.name]));

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "housekeeping-strength-view",
      page,
      sortBy,
      sortDir,
      campusFilter,
      locationFilter,
      blockCommitted,
      floorVenueCommitted,
      shiftFilter,
      statusFilter,
      vacancyFilter,
      search,
    ],
    queryFn: () =>
      listHousekeepingStrengthRows({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        sort_by: sortBy,
        sort_dir: sortDir,
        campus_code: campusFilter === "ALL" ? null : campusFilter,
        location_id: locationFilter === "ALL" ? null : locationFilter,
        block: blockCommitted.trim() || null,
        floor_venue: floorVenueCommitted.trim() || null,
        shift: shiftFilter === "ALL" ? null : shiftFilter,
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
      exportStrengthView("housekeeping", {
        campusCode: campusFilter === "ALL" ? null : campusFilter,
        locationId: locationFilter === "ALL" ? null : locationFilter,
        block: blockCommitted.trim() || null,
        floorVenue: floorVenueCommitted.trim() || null,
        shift: shiftFilter === "ALL" ? null : shiftFilter,
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

  function commitBlock() {
    setBlockCommitted(blockFilter);
    setPage(0);
  }

  function commitFloorVenue() {
    setFloorVenueCommitted(floorVenueFilter);
    setPage(0);
  }

  function commitVacancy() {
    const trimmed = vacancyInput.trim();
    setVacancyFilter(trimmed === "" ? null : Number(trimmed));
    setPage(0);
  }

  function toggleExpandedLocation(locationId: string) {
    setExpandedLocationIds((prev) => {
      const next = new Set(prev);
      if (next.has(locationId)) next.delete(locationId);
      else next.add(locationId);
      return next;
    });
  }

  // Campus is deliberately never pickable from this table's own "Add staff"
  // action (the shared drawer is always mounted with canChooseCampus={false}
  // below) -- unlike HousekeepingStaffListPage.tsx's own "Add staff" button
  // (which lets a global-scope role choose freely, since it has no location
  // context yet), this row already fixes both the location *and* its
  // campus; letting the campus field be edited independently here would let
  // a user pick a campus that doesn't match the pre-filled location, a
  // combination the backend would reject as invalid.
  function openAddStaffDrawer(row: HousekeepingStrengthRow) {
    setEditingRecord(null);
    setPrefillLocationId(row.location_id);
    setPrefillCampusId(row.campus_id ?? undefined);
    setDrawerOpen(true);
  }

  function openEditStaffDrawer(record: HousekeepingStaffRead) {
    setEditingRecord(record);
    setPrefillLocationId(undefined);
    setPrefillCampusId(undefined);
    setDrawerOpen(true);
  }

  function afterStaffSaved() {
    void queryClient.invalidateQueries({ queryKey: ["housekeeping-staff-by-location"] });
    void queryClient.invalidateQueries({ queryKey: ["housekeeping-strength-view"] });
  }

  const hasAnyFilter =
    campusFilter !== "ALL" ||
    locationFilter !== "ALL" ||
    blockCommitted.trim() !== "" ||
    floorVenueCommitted.trim() !== "" ||
    shiftFilter !== "ALL" ||
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
        variant="REQUIRED_AVAILABLE"
        totalRecords={data?.status_counts.ALL}
        approvedOrRequired={data?.required_total}
        workingOrAvailable={data?.available_total}
        vacancyTotal={data?.vacancy_total}
        fullyStaffed={data?.status_counts.FULLY_STAFFED}
        recruitmentRequired={data?.status_counts.VACANCY_RECRUITMENT_REQUIRED}
        isLoading={isLoading}
      />

      {/* Filter bar -- one clean responsive row (2026-08-29 colour pass).
          Wrapped in its own card surface so the controls read as a single
          toolbar against the page's light-blue background rather than
          floating loose, and Export is pushed to the trailing edge with
          `ml-auto` so it stays "near the filters" without sitting in the
          middle of them. Purely layout: every control, its aria-label and
          its handler are unchanged. */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-card)]">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onBlur={commitSearch}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitSearch();
          }}
          placeholder="Search location or block"
          aria-label="Search"
          className="sm:w-56"
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
        <div className="w-40">
          <Select value={locationFilter} onValueChange={(v) => { setLocationFilter(v); setPage(0); }}>
            <SelectTrigger aria-label="Location filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All locations</SelectItem>
              {housekeepingLocations.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {location.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Input
          value={blockFilter}
          onChange={(e) => setBlockFilter(e.target.value)}
          onBlur={commitBlock}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitBlock();
          }}
          placeholder="Block"
          aria-label="Block filter"
          className="w-32"
        />
        <Input
          value={floorVenueFilter}
          onChange={(e) => setFloorVenueFilter(e.target.value)}
          onBlur={commitFloorVenue}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitFloorVenue();
          }}
          placeholder="Floor / Venue"
          aria-label="Floor / Venue filter"
          className="w-36"
        />
        <div className="w-36">
          <Select value={shiftFilter} onValueChange={(v) => { setShiftFilter(v as HousekeepingShift | "ALL"); setPage(0); }}>
            <SelectTrigger aria-label="Shift filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All shifts</SelectItem>
              {SHIFT_VALUES.map((shiftValue) => (
                <SelectItem key={shiftValue} value={shiftValue}>
                  {SHIFT_LABELS[shiftValue]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-56">
          <Select
            value={statusFilter}
            onValueChange={(v) => { setStatusFilter(v as HousekeepingStrengthStatus | "ALL"); setPage(0); }}
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
          className="ml-auto"
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
                {error instanceof ApiError ? error.message : "Failed to load the Housekeeping strength view."}
              </TableEmpty>
            ) : rows.length === 0 ? (
              <TableEmpty colSpan={TOTAL_COLUMN_COUNT}>
                {hasAnyFilter
                  ? "No locations match these filters."
                  : "No sanctioned Housekeeping locations found."}
              </TableEmpty>
            ) : (
              rows.map((row: HousekeepingStrengthRow) => {
                const statusDisplay = STATUS_DISPLAY[row.status];
                const isExpanded = expandedLocationIds.has(row.location_id);
                const rowLabel = row.location_name ?? "this location";
                return (
                  <Fragment key={row.location_id}>
                    <TableRow>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => toggleExpandedLocation(row.location_id)}
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? "Collapse" : "Expand"} roster for ${rowLabel}`}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="h-4 w-4" aria-hidden="true" />
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="font-medium">{row.location_name ?? "—"}</TableCell>
                      <TableCell>{row.block ?? "—"}</TableCell>
                      <TableCell>{row.floor_venue ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{row.required}</TableCell>
                      <TableCell className="tabular-nums">{row.available}</TableCell>
                      <TableCell className="tabular-nums">{row.vacancy}</TableCell>
                      <TableCell>
                        {row.shifts.length === 0 ? (
                          "—"
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {row.shifts.map((shift) => (
                              <Badge key={shift} variant="outline">
                                {SHIFT_LABELS[shift] ?? statusLabel(shift)}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusDisplay.variant}>{statusDisplay.label}</Badge>
                      </TableCell>
                      <TableCell>
                        {canManage ? (
                          <Button variant="outline" size="sm" onClick={() => openAddStaffDrawer(row)}>
                            Add staff
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                    {isExpanded ? (
                      <RosterExpandRow
                        locationId={row.location_id}
                        canManage={canManage}
                        onEdit={openEditStaffDrawer}
                        designationById={designationById}
                      />
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </table>
      </div>

      <Pagination total={total} limit={limit} offset={offset} onOffsetChange={(next) => setPage(next / limit)} itemLabel="locations" />

      {canManage ? (
        <HousekeepingStaffFormDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          record={editingRecord}
          canChooseCampus={false}
          defaultCampusId={prefillCampusId ?? editingRecord?.campus_id ?? ""}
          initialLocationId={prefillLocationId}
          initialCampusId={prefillCampusId}
          onSaved={afterStaffSaved}
        />
      ) : null}
    </>
  );
}
