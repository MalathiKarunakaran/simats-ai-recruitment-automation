import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import { ApiError } from "@/api/client";
import * as departmentsApi from "@/api/departments";
import * as designationsApi from "@/api/designations";
import * as employeesApi from "@/api/employees";
import * as housekeepingStaffApi from "@/api/housekeepingStaff";
import * as locationsApi from "@/api/locations";
import * as sanctionedStrengthApi from "@/api/sanctionedStrength";
import type { SanctionedStrengthListResponse } from "@/api/sanctionedStrength";
import * as sanctionedStrengthViewsApi from "@/api/sanctionedStrengthViews";
import type {
  DepartmentDesignationBreakdownRow,
  DepartmentRead,
  DesignationRead,
  EmployeeRead,
  HousekeepingStaffRead,
  HousekeepingStrengthListResponse,
  HousekeepingStrengthRow,
  LocationRead,
  NonTeachingStrengthListResponse,
  NonTeachingStrengthRow,
  SanctionedStrengthHistoryRead,
  SanctionedStrengthRead,
  TeachingStrengthListResponse,
  TeachingStrengthRow,
  UserRead,
  UserRole,
  VacancyRegisterRow,
} from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { SanctionedStrengthPage } from "@/pages/SanctionedStrengthPage";

vi.mock("@/api/sanctionedStrength");
vi.mock("@/api/sanctionedStrengthViews");
vi.mock("@/api/campuses");
vi.mock("@/api/departments");
vi.mock("@/api/designations");
vi.mock("@/api/locations");
vi.mock("@/api/employees");
vi.mock("@/api/housekeepingStaff");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedListSanctionedStrengthRegister = vi.mocked(sanctionedStrengthApi.listSanctionedStrengthRegister);
const mockedGetBreakdown = vi.mocked(sanctionedStrengthApi.getDepartmentSanctionedStrengthBreakdown);
const mockedCreateSanctionedStrength = vi.mocked(sanctionedStrengthApi.createSanctionedStrength);
const mockedUpdateSanctionedStrength = vi.mocked(sanctionedStrengthApi.updateSanctionedStrength);
const mockedDeleteSanctionedStrength = vi.mocked(sanctionedStrengthApi.deleteSanctionedStrength);
const mockedGetSanctionedStrengthHistory = vi.mocked(sanctionedStrengthApi.getSanctionedStrengthHistory);
const mockedListBulkUploads = vi.mocked(sanctionedStrengthApi.listSanctionedStrengthBulkUploads);
const mockedListTeachingStrengthRows = vi.mocked(sanctionedStrengthViewsApi.listTeachingStrengthRows);
const mockedListNonTeachingStrengthRows = vi.mocked(sanctionedStrengthViewsApi.listNonTeachingStrengthRows);
const mockedListHousekeepingStrengthRows = vi.mocked(sanctionedStrengthViewsApi.listHousekeepingStrengthRows);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedListDepartments = vi.mocked(departmentsApi.listDepartments);
const mockedListDesignations = vi.mocked(designationsApi.listDesignations);
const mockedListLocations = vi.mocked(locationsApi.listLocations);
const mockedListEmployeesByDepartmentDesignation = vi.mocked(employeesApi.listEmployeesByDepartmentDesignation);
const mockedListHousekeepingStaffByLocation = vi.mocked(housekeepingStaffApi.listHousekeepingStaffByLocation);
const mockedCreateHousekeepingStaff = vi.mocked(housekeepingStaffApi.createHousekeepingStaff);
const mockedDeleteHousekeepingStaff = vi.mocked(housekeepingStaffApi.deleteHousekeepingStaff);
const mockedUseAuth = vi.mocked(authContext.useAuth);

const CSE_ROW: VacancyRegisterRow = {
  department_id: "d-cse",
  department_name: "Computer Science",
  department_code: "CSE",
  category: "TEACHING",
  is_active: true,
  campus_id: "c-sse",
  campus_code: "SSE",
  working_count: 8,
  vacancy_count: 2,
  approved_count: 10,
  filled_pct: 80,
  requested_count: 10,
  approved_request_count: 10,
  jd_posted_count: 10,
  interviews_count: 6,
  offers_count: 4,
  joined_count: 8,
  recruitment_status: "VACANCY_EXISTS",
  recruitment_status_request_count: 2,
  approval_status: "APPROVED",
  approval_status_request_count: 10,
  last_join: "2026-07-01",
  last_resignation: null,
  last_updated: "2026-08-01T10:00:00Z",
};

const MECH_ROW: VacancyRegisterRow = {
  department_id: "d-mech",
  department_name: "Mechanical Engineering",
  department_code: "MECH",
  category: "TEACHING",
  is_active: true,
  campus_id: "c-scad",
  campus_code: "SCAD",
  working_count: 5,
  vacancy_count: 0,
  approved_count: 5,
  filled_pct: null,
  requested_count: 0,
  approved_request_count: 0,
  jd_posted_count: 0,
  interviews_count: 0,
  offers_count: 0,
  joined_count: 0,
  recruitment_status: "NO_ACTIVITY",
  recruitment_status_request_count: 0,
  approval_status: "NO_REQUESTS",
  approval_status_request_count: 0,
  last_join: null,
  last_resignation: "2026-06-15",
  last_updated: "2026-07-15T09:00:00Z",
};

function paginated(
  items: VacancyRegisterRow[],
  total = items.length,
  categoryCounts?: Record<string, number>,
): SanctionedStrengthListResponse {
  return {
    items,
    total,
    limit: 50,
    offset: 0,
    category_counts: categoryCounts ?? {
      TEACHING: items.filter((r) => r.category === "TEACHING").length,
      NON_TEACHING: items.filter((r) => r.category === "NON_TEACHING").length,
      HOUSEKEEPING: items.filter((r) => r.category === "HOUSEKEEPING").length,
      ALL: items.length,
    },
  };
}

// --- Teaching operational view fixtures (glowing-zooming-hamming.md Phase E) ---

const TEACHING_ROW_1: TeachingStrengthRow = {
  sanctioned_strength_id: "ts-1",
  campus_id: "c-sse",
  campus_code: "SSE",
  department_id: "d-cse",
  department_name: "Computer Science",
  designation_id: "des-1",
  designation_name: "Assistant Professor",
  location_id: "loc-1",
  location_name: "Block A",
  approved: 10,
  working: 7,
  vacancy: 3,
  filled_pct: 70,
  status: "VACANCY_RECRUITMENT_REQUIRED",
  last_join: "2026-07-01",
  last_resignation: null,
  last_updated: "2026-08-01T10:00:00Z",
};

const TEACHING_ROW_2: TeachingStrengthRow = {
  sanctioned_strength_id: "ts-2",
  campus_id: "c-sse",
  campus_code: "SSE",
  department_id: "d-mech",
  department_name: "Mechanical Engineering",
  designation_id: "des-2",
  designation_name: "Professor",
  location_id: null,
  location_name: null,
  approved: 5,
  working: 5,
  vacancy: 0,
  filled_pct: 100,
  status: "FULLY_STAFFED",
  last_join: null,
  last_resignation: "2026-06-15",
  last_updated: "2026-07-15T09:00:00Z",
};

// Phase K (glowing-zooming-hamming.md) KPI summary fields -- optional 4th
// param defaults to plain sums over `items` (same "derive a sane default
// from the fixture rows, let individual tests override it" convention as
// `statusCounts` above) so every pre-existing call site keeps working
// unchanged while the new KPI-summary-specific tests below pass explicit,
// deliberately-signed totals (e.g. a negative vacancy_total that isn't
// derivable from any single positive-vacancy row).
function paginatedTeaching(
  items: TeachingStrengthRow[],
  total = items.length,
  statusCounts?: Record<string, number>,
  kpiTotals?: { approved_total: number; working_total: number; vacancy_total: number },
): TeachingStrengthListResponse {
  return {
    items,
    total,
    limit: 50,
    offset: 0,
    status_counts: statusCounts ?? {
      VACANCY_RECRUITMENT_REQUIRED: items.filter((r) => r.status === "VACANCY_RECRUITMENT_REQUIRED").length,
      FULLY_STAFFED: items.filter((r) => r.status === "FULLY_STAFFED").length,
      OVERSTAFFED: items.filter((r) => r.status === "OVERSTAFFED").length,
      APPROVAL_PENDING: items.filter((r) => r.status === "APPROVAL_PENDING").length,
      INACTIVE: items.filter((r) => r.status === "INACTIVE").length,
      ALL: items.length,
    },
    approved_total: kpiTotals?.approved_total ?? items.reduce((sum, r) => sum + r.approved, 0),
    working_total: kpiTotals?.working_total ?? items.reduce((sum, r) => sum + r.working, 0),
    vacancy_total: kpiTotals?.vacancy_total ?? items.reduce((sum, r) => sum + r.vacancy, 0),
  };
}

// Populates the Teaching table's own Department/Designation/Location filter
// dropdowns -- fetched unconditionally on mount (small master-data lists,
// same eager-fetch convention as SanctionedStrengthDrawer's own designations
// query, just not gated behind an "open" flag since these are plain filter
// Selects, not a create-row form).
function mockTeachingFilterData() {
  const now = "2026-01-01T00:00:00Z";
  mockedListDepartments.mockResolvedValue([
    { id: "d-cse", campus_id: "c-sse", name: "Computer Science", code: "CSE", category: "TEACHING", parent_group: null, is_active: true, created_at: now, updated_at: now },
    { id: "d-mech", campus_id: "c-sse", name: "Mechanical Engineering", code: "MECH", category: "TEACHING", parent_group: null, is_active: true, created_at: now, updated_at: now },
  ] satisfies DepartmentRead[]);
  mockedListDesignations.mockResolvedValue([
    { id: "des-1", name: "Assistant Professor", category: "TEACHING", qualification: "PhD", min_experience: "0+ years", employment_type: "FULL_TIME", is_active: true, department_ids: ["d-cse"], created_at: now, updated_at: now },
    { id: "des-2", name: "Professor", category: "TEACHING", qualification: "PhD", min_experience: "10+ years", employment_type: "FULL_TIME", is_active: true, department_ids: ["d-mech"], created_at: now, updated_at: now },
  ] satisfies DesignationRead[]);
  mockedListLocations.mockResolvedValue([
    { id: "loc-1", campus_id: "c-sse", name: "Block A", block_building: "A", floor_venue: "1st Floor", category: "TEACHING", is_active: true, created_at: now, updated_at: now },
  ] satisfies LocationRead[]);
}

// --- Non-Teaching operational view fixtures (glowing-zooming-hamming.md Phase F) ---

const NON_TEACHING_ROW_1: NonTeachingStrengthRow = {
  sanctioned_strength_id: "nts-1",
  campus_id: "c-sse",
  campus_code: "SSE",
  department_id: "d-admin",
  department_name: "Administration",
  designation_id: "des-10",
  designation_name: "Office Assistant",
  location_id: "loc-2",
  location_name: "Block B",
  approved: 6,
  working: 4,
  vacancy: 2,
  filled_pct: 67,
  status: "VACANCY_RECRUITMENT_REQUIRED",
  last_join: "2026-07-10",
  last_resignation: null,
  last_updated: "2026-08-01T10:00:00Z",
};

const NON_TEACHING_ROW_2: NonTeachingStrengthRow = {
  sanctioned_strength_id: "nts-2",
  campus_id: "c-sse",
  campus_code: "SSE",
  department_id: "d-lib",
  department_name: "Library",
  designation_id: "des-11",
  designation_name: "Librarian",
  location_id: null,
  location_name: null,
  approved: 3,
  working: 3,
  vacancy: 0,
  filled_pct: 100,
  status: "FULLY_STAFFED",
  last_join: null,
  last_resignation: "2026-06-20",
  last_updated: "2026-07-20T09:00:00Z",
};

// Same Phase K optional-4th-param convention as paginatedTeaching() above.
function paginatedNonTeaching(
  items: NonTeachingStrengthRow[],
  total = items.length,
  statusCounts?: Record<string, number>,
  kpiTotals?: { approved_total: number; working_total: number; vacancy_total: number },
): NonTeachingStrengthListResponse {
  return {
    items,
    total,
    limit: 50,
    offset: 0,
    status_counts: statusCounts ?? {
      VACANCY_RECRUITMENT_REQUIRED: items.filter((r) => r.status === "VACANCY_RECRUITMENT_REQUIRED").length,
      FULLY_STAFFED: items.filter((r) => r.status === "FULLY_STAFFED").length,
      OVERSTAFFED: items.filter((r) => r.status === "OVERSTAFFED").length,
      APPROVAL_PENDING: items.filter((r) => r.status === "APPROVAL_PENDING").length,
      INACTIVE: items.filter((r) => r.status === "INACTIVE").length,
      ALL: items.length,
    },
    approved_total: kpiTotals?.approved_total ?? items.reduce((sum, r) => sum + r.approved, 0),
    working_total: kpiTotals?.working_total ?? items.reduce((sum, r) => sum + r.working, 0),
    vacancy_total: kpiTotals?.vacancy_total ?? items.reduce((sum, r) => sum + r.vacancy, 0),
  };
}

// Populates the Non-Teaching table's own Department/Designation/Location
// filter dropdowns -- same eager-fetch convention as mockTeachingFilterData()
// above, just NON_TEACHING category throughout. "Block B" carries a real
// block_building so the new Block column (client-side join against this
// same locations list, see NonTeachingStrengthTable's own docstring) has
// something non-null to resolve in tests.
function mockNonTeachingFilterData() {
  const now = "2026-01-01T00:00:00Z";
  mockedListDepartments.mockResolvedValue([
    { id: "d-admin", campus_id: "c-sse", name: "Administration", code: "ADMIN", category: "NON_TEACHING", parent_group: null, is_active: true, created_at: now, updated_at: now },
    { id: "d-lib", campus_id: "c-sse", name: "Library", code: "LIB", category: "NON_TEACHING", parent_group: null, is_active: true, created_at: now, updated_at: now },
  ] satisfies DepartmentRead[]);
  mockedListDesignations.mockResolvedValue([
    { id: "des-10", name: "Office Assistant", category: "NON_TEACHING", qualification: "Any Degree", min_experience: "0+ years", employment_type: "FULL_TIME", is_active: true, department_ids: ["d-admin"], created_at: now, updated_at: now },
    { id: "des-11", name: "Librarian", category: "NON_TEACHING", qualification: "MLIS", min_experience: "2+ years", employment_type: "FULL_TIME", is_active: true, department_ids: ["d-lib"], created_at: now, updated_at: now },
  ] satisfies DesignationRead[]);
  mockedListLocations.mockResolvedValue([
    { id: "loc-2", campus_id: "c-sse", name: "Block B", block_building: "B", floor_venue: "Ground Floor", category: "NON_TEACHING", is_active: true, created_at: now, updated_at: now },
  ] satisfies LocationRead[]);
}

const EMPLOYEE_1: EmployeeRead = {
  id: "emp-1",
  application_id: "app-1",
  employee_code: "EMP001",
  campus_id: "c-sse",
  department_id: "d-admin",
  full_name: "Priya Kumar",
  email: "priya@example.com",
  phone_number: null,
  designation: "Office Assistant",
  date_of_joining: "2026-07-10",
  user_id: null,
  employment_status: "ACTIVE",
  separation_date: null,
  separation_reason: null,
  separated_by_id: null,
  created_at: "2026-07-10T00:00:00Z",
  updated_at: "2026-07-10T00:00:00Z",
};

// --- Housekeeping operational view fixtures (glowing-zooming-hamming.md Phase G) ---

const HOUSEKEEPING_ROW_1: HousekeepingStrengthRow = {
  campus_id: "c-sse",
  campus_code: "SSE",
  location_id: "loc-hk-1",
  location_name: "Central Library",
  block: "Block A",
  floor_venue: "Ground Floor",
  shifts: ["EVENING", "MORNING"],
  required: 5,
  available: 3,
  vacancy: 2,
  status: "VACANCY_RECRUITMENT_REQUIRED",
};

// available (6) > required (2) -- OVERSTAFFED status while vacancy still
// reads the FLOORED value (0), never negative. See
// app/services/sanctioned_strength_views.py's own module docstring, Phase G
// judgment call #2, and api/types.ts's own HousekeepingStrengthRow
// docstring.
const HOUSEKEEPING_ROW_2: HousekeepingStrengthRow = {
  campus_id: "c-sse",
  campus_code: "SSE",
  location_id: "loc-hk-2",
  location_name: "Admin Block",
  block: null,
  floor_venue: null,
  shifts: [],
  required: 2,
  available: 6,
  vacancy: 0,
  status: "OVERSTAFFED",
};

// Same Phase K optional-4th-param convention as paginatedTeaching() above --
// note the default vacancy_total here follows HousekeepingStrengthListResponse's
// own documented derivation (required_total - available_total, NOT a sum of
// each row's own floored `vacancy`), same as the real backend.
function paginatedHousekeeping(
  items: HousekeepingStrengthRow[],
  total = items.length,
  statusCounts?: Record<string, number>,
  kpiTotals?: { required_total: number; available_total: number; vacancy_total: number },
): HousekeepingStrengthListResponse {
  const requiredTotal = kpiTotals?.required_total ?? items.reduce((sum, r) => sum + r.required, 0);
  const availableTotal = kpiTotals?.available_total ?? items.reduce((sum, r) => sum + r.available, 0);
  return {
    items,
    total,
    limit: 50,
    offset: 0,
    status_counts: statusCounts ?? {
      VACANCY_RECRUITMENT_REQUIRED: items.filter((r) => r.status === "VACANCY_RECRUITMENT_REQUIRED").length,
      FULLY_STAFFED: items.filter((r) => r.status === "FULLY_STAFFED").length,
      OVERSTAFFED: items.filter((r) => r.status === "OVERSTAFFED").length,
      APPROVAL_PENDING: items.filter((r) => r.status === "APPROVAL_PENDING").length,
      INACTIVE: items.filter((r) => r.status === "INACTIVE").length,
      ALL: items.length,
    },
    required_total: requiredTotal,
    available_total: availableTotal,
    vacancy_total: kpiTotals?.vacancy_total ?? requiredTotal - availableTotal,
  };
}

const HK_DESIGNATION: DesignationRead = {
  id: "des-hk-1",
  name: "Cleaner",
  category: "HOUSEKEEPING",
  qualification: "10th pass",
  min_experience: "0+ years",
  employment_type: "FULL_TIME",
  is_active: true,
  department_ids: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// Populates the Housekeeping table's own Location filter dropdown and the
// designation lookup its roster expand row resolves names from -- no
// Department fixture at all (this view has no department dimension, see
// HousekeepingStrengthTable's own docstring).
function mockHousekeepingFilterData() {
  const now = "2026-01-01T00:00:00Z";
  mockedListDesignations.mockResolvedValue([HK_DESIGNATION]);
  mockedListLocations.mockResolvedValue([
    { id: "loc-hk-1", campus_id: "c-sse", name: "Central Library", block_building: "Block A", floor_venue: "Ground Floor", category: "HOUSEKEEPING", is_active: true, created_at: now, updated_at: now },
    { id: "loc-hk-2", campus_id: "c-sse", name: "Admin Block", block_building: null, floor_venue: null, category: "HOUSEKEEPING", is_active: true, created_at: now, updated_at: now },
  ] satisfies LocationRead[]);
}

const HOUSEKEEPING_STAFF_1: HousekeepingStaffRead = {
  id: "hk-staff-1",
  campus_id: "c-sse",
  bio_id: "BIO-100",
  name: "Kamala Devi",
  designation_id: "des-hk-1",
  location_id: "loc-hk-1",
  block: "Block A",
  floor_venue: "Ground Floor",
  shift: "MORNING",
  supervisor: "Ramesh",
  is_active: true,
  created_by_id: "u-1",
  updated_by_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// Locates one of StrengthKpiSummary's own tiles by its label (Phase K,
// glowing-zooming-hamming.md) -- "Approved"/"Working" collide with real
// visible text elsewhere on these tables (their own sortable column
// headers carry the identical label), so a bare screen.getByText(label)
// can match more than one element once the KPI summary row is on-screen
// too. Filters getAllByText's matches down to the one that's actually
// inside a StatTile Card (".rounded-xl", same selector convention
// DashboardPage.test.tsx's own KPI-tile tests already use) rather than a
// <th>/<button> column header.
function getKpiTile(label: string): HTMLElement {
  const matches = screen.getAllByText(label);
  const tile = matches.map((el) => el.closest(".rounded-xl")).find((el): el is HTMLElement => el !== null);
  if (!tile) throw new Error(`No KPI tile found for label "${label}"`);
  return tile;
}

function mockAuth(role: UserRole) {
  mockedUseAuth.mockReturnValue({
    user: { role } as UserRead,
    isLoading: false,
    login: vi.fn(),
    requestOtp: vi.fn(),
    loginWithOtp: vi.fn(),
    logout: vi.fn(),
  });
}

function mockCampuses() {
  mockedListCampuses.mockResolvedValue([
    { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    { id: "c-scad", code: "SCAD", name: "SCAD Campus", is_active: true, created_at: "", updated_at: "" },
  ]);
}

// Defaults to ?category=all (glowing-zooming-hamming.md Phases E/F/G) --
// SanctionedStrengthPage now defaults to the TEACHING tab (its own
// TeachingStrengthTable, a completely different component/endpoint), and by
// Phase F NON_TEACHING was *also* its own dedicated component
// (NonTeachingStrengthTable). As of this file's own Phase G update,
// HOUSEKEEPING is the third and last of the three staff categories to get
// its own dedicated component (HousekeepingStrengthTable) -- which means
// "All" is now the *only* remaining tab that still exercises the pre-existing
// department-rollup+expand table (backed by listSanctionedStrengthRegister).
// This function's own default changed from HOUSEKEEPING (Phases E/F's
// choice, back when Housekeeping had no dedicated view yet) to ALL for
// exactly that reason -- every test in this file *except* the dedicated
// "Teaching operational view"/"Non-Teaching operational view"/"Housekeeping
// operational view" describe blocks below still needs a tab that renders
// the legacy rollup table, and ALL is the only one left. Tests that
// previously relied on the HOUSEKEEPING default to reach the rollup table
// (or explicitly clicked/passed category=housekeeping to force it) were
// updated in this same phase -- see the comments at each call site below for
// what changed and why (mirrors this file's own precedent: the Phase E->F
// default-tab change from NON_TEACHING to HOUSEKEEPING broke one test the
// same way, documented at that test's own site).
function renderPage(initialEntries: string[] = ["/sanctioned-strength?category=all"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <SanctionedStrengthPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SanctionedStrengthPage", () => {
  it("renders the Sanctioned Strength title and subtitle", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW]));

    renderPage();

    expect(await screen.findByRole("heading", { name: "Sanctioned Strength" })).toBeInTheDocument();
    expect(
      screen.getByText("Sanctioned vs working strength per department. This defines how many posts may be requested."),
    ).toBeInTheDocument();
  });

  it("renders rows with column values and status badges for every enum value", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));

    renderPage();

    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());
    expect(screen.getByText("Mechanical Engineering")).toBeInTheDocument();

    // CSE row: VACANCY_EXISTS / APPROVED. Scoped to a <span> (the Badge
    // element) since the sortable "Approved" column header is also a
    // clickable <button> containing the plain text "Approved", the Approval
    // Status filter's Select also contains an "Approved" option, and (Phase
    // E item 28) the badge itself is now wrapped in a <Link>, whose own
    // textContent also matches. The label carries the *_request_count
    // (Phase B/E) in parentheses.
    expect(screen.getByText("Vacancy Exists (2)", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Approved (10)", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();

    // MECH row: NO_ACTIVITY / NO_REQUESTS, null filled_pct.
    expect(screen.getByText("No Activity (0)", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("No Requests (0)", { selector: "span" })).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders the remaining recruitment/approval status enum values as badges", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    const fullyStaffed: VacancyRegisterRow = { ...CSE_ROW, department_id: "d-a", recruitment_status: "FULLY_STAFFED" };
    const overstaffed: VacancyRegisterRow = { ...CSE_ROW, department_id: "d-b", recruitment_status: "OVERSTAFFED" };
    const pending: VacancyRegisterRow = { ...CSE_ROW, department_id: "d-c", approval_status: "APPROVAL_PENDING" };
    const rejected: VacancyRegisterRow = { ...CSE_ROW, department_id: "d-d", approval_status: "REJECTED" };
    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([fullyStaffed, overstaffed, pending, rejected]));

    renderPage();

    // Every row here spreads CSE_ROW, so all 4 carry its
    // recruitment_status_request_count (2) / approval_status_request_count
    // (10) unchanged.
    await waitFor(() =>
      expect(screen.getByText("Fully Staffed (2)", { selector: "span" })).toBeInTheDocument(),
    );
    expect(screen.getByText("Overstaffed (2)", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Approval Pending (10)", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Rejected (10)", { selector: "span" })).toBeInTheDocument();
  });

  it("makes the Recruitment/Approval Status badges clickable through to the Vacancy Requests list, scoped to this department (Phase E item 28)", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW]));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    const recruitmentLink = screen.getByText("Vacancy Exists (2)", { selector: "span" }).closest("a");
    expect(recruitmentLink).toHaveAttribute("href", "/vacancy-requests?department=d-cse");

    const approvalLink = screen.getByText("Approved (10)", { selector: "span" }).closest("a");
    expect(approvalLink).toHaveAttribute("href", "/vacancy-requests?department=d-cse");
  });

  it("auto-expands the department named in ?department= on mount (Phase E item 29 reverse link)", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
    mockedGetBreakdown.mockResolvedValue([]);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        {/* &category=all -- this reverse-link test exercises the rollup
            table's expand/collapse behavior specifically, which is
            unrelated to (and unaffected by) which category is selected, as
            long as that category still renders the rollup table -- as of
            Phase G, "All" is the only one that does (Teaching/Non-Teaching/
            Housekeeping are all now their own dedicated components with no
            expand affordance at all). */}
        <MemoryRouter initialEntries={["/sanctioned-strength?department=d-cse&designation=des-1&category=all"]}>
          <SanctionedStrengthPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());
    await waitFor(() => expect(mockedGetBreakdown).toHaveBeenCalledWith("d-cse"));
    expect(screen.getByRole("button", { name: /Collapse Computer Science/ })).toBeInTheDocument();
  });

  it("sorts by a clicked column ascending, then toggles to descending on a second click", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    const approvedHeader = screen.getByRole("columnheader", { name: /Approved/ });
    expect(approvedHeader).toHaveAttribute("aria-sort", "none");

    await userEvent.click(screen.getByRole("button", { name: /Approved/ }));

    await waitFor(() =>
      expect(mockedListSanctionedStrengthRegister).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort_by: "approved_count", sort_dir: "asc", offset: 0 }),
      ),
    );
    await waitFor(() => expect(approvedHeader).toHaveAttribute("aria-sort", "ascending"));

    await userEvent.click(screen.getByRole("button", { name: /Approved/ }));

    await waitFor(() =>
      expect(mockedListSanctionedStrengthRegister).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort_by: "approved_count", sort_dir: "desc", offset: 0 }),
      ),
    );
    await waitFor(() => expect(approvedHeader).toHaveAttribute("aria-sort", "descending"));
  });

  it("paginates with Previous/Next, calling the API with the right offset and disabling at the boundaries", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW], 120));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    const previousButton = screen.getByRole("button", { name: "Previous" });
    const nextButton = screen.getByRole("button", { name: "Next" });
    expect(previousButton).toBeDisabled();
    expect(nextButton).not.toBeDisabled();
    expect(screen.getByText("Showing 1–50 of 120 departments")).toBeInTheDocument();

    await userEvent.click(nextButton);

    await waitFor(() =>
      expect(mockedListSanctionedStrengthRegister).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })),
    );
    await waitFor(() => expect(previousButton).not.toBeDisabled());

    await userEvent.click(previousButton);

    await waitFor(() =>
      expect(mockedListSanctionedStrengthRegister).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 })),
    );
  });

  it("disables Next on the last page", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW], 2));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByText("Showing 1–2 of 2 departments")).toBeInTheDocument();
  });

  it("shows a loading state", () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListSanctionedStrengthRegister.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows a genuine 'no departments at all' empty state when no filters are active", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([]));

    // Explicit ?category=all -- redundant with renderPage()'s own default as
    // of Phase G (also "all"), kept explicit here as a guard against that
    // default ever changing again: any non-"ALL" categoryFilter is itself a
    // real filter (hasAnyFilter treats categoryFilter !== "ALL" as a
    // filter), which would flip this into the *filters-narrowed* empty
    // state below instead of this genuine one.
    renderPage(["/sanctioned-strength?category=all"]);

    expect(await screen.findByText("No departments found.")).toBeInTheDocument();
  });

  it("shows a filters-narrowed empty state (distinct wording) when a filter is active and the result is empty", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW]));

    // As of Phase G, "All" is the *only* tab left that renders this rollup
    // table (Teaching/Non-Teaching/Housekeeping are all now their own
    // dedicated components -- see renderPage()'s own comment), so a category
    // tab click can no longer be this test's "narrowing filter" the way it
    // was pre-Phase-G (start on "all", click "Housekeeping" while it was
    // still the rollup table too). Uses the Approval status filter instead
    // -- any of this page's own filters narrows the same way; this one was
    // picked simply because it's a plain Select, same low-ceremony shape as
    // the category-tab click it replaces.
    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([]));
    await userEvent.click(screen.getByRole("combobox", { name: "Approval status filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Approval Pending" }));

    expect(await screen.findByText("No departments match these filters.")).toBeInTheDocument();
    expect(screen.queryByText("No departments found.")).not.toBeInTheDocument();
  });

  it("surfaces an ApiError message on failure", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListSanctionedStrengthRegister.mockRejectedValue(new ApiError(500, "Server exploded"));

    renderPage();

    expect(await screen.findByText("Server exploded")).toBeInTheDocument();
  });

  it("shows the campus filter for a global-scope role but hides it for a single-campus role", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW]));
    const { unmount } = renderPage();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Campus filter" })).toBeInTheDocument());
    unmount();

    mockAuth("CAMPUS_HOD");
    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());
    expect(screen.queryByRole("combobox", { name: "Campus filter" })).not.toBeInTheDocument();
  });

  it("re-fetches with campus_code and resets pagination to page 0 when the campus filter changes", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW], 120));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    // Move off page 0 first so the reset-to-0 assertion is meaningful.
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(mockedListSanctionedStrengthRegister).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })),
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SCAD" }));

    await waitFor(() =>
      expect(mockedListSanctionedStrengthRegister).toHaveBeenLastCalledWith(
        expect.objectContaining({ campus_code: "SCAD", offset: 0 }),
      ),
    );
  });

  it("re-fetches with category and resets pagination to page 0 when the category filter changes", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW], 120));
    // Phase G: Housekeeping is now its own dedicated view/component (like
    // Teaching/Non-Teaching before it) -- "All" is the only tab left that
    // renders the rollup table, so this test now starts there
    // (renderPage()'s own default, as of this phase) rather than switching
    // *to* it. The underlying behavior under test -- that a category tab
    // click re-fires listSanctionedStrengthRegister with the new category
    // param and offset reset to 0 -- still holds regardless of which tab is
    // switched *to*, since that query itself always runs unconditionally
    // (CategoryTabs' own counts need it) whether or not the clicked tab
    // happens to render this query's rows. Switches to Housekeeping instead
    // of All (the reverse of the pre-Phase-G direction) to keep exercising
    // a real, non-null category value change.
    mockedListHousekeepingStrengthRows.mockResolvedValue(paginatedHousekeeping([]));
    mockedListLocations.mockResolvedValue([]);
    mockedListDesignations.mockResolvedValue([]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(mockedListSanctionedStrengthRegister).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })),
    );

    await userEvent.click(screen.getByRole("tab", { name: /^Housekeeping/ }));

    await waitFor(() =>
      expect(mockedListSanctionedStrengthRegister).toHaveBeenLastCalledWith(
        expect.objectContaining({ category: "HOUSEKEEPING", offset: 0 }),
      ),
    );
  });

  it("re-fetches with approval_status and resets pagination to page 0 when the approval status filter changes", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW], 120));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(mockedListSanctionedStrengthRegister).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })),
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Approval status filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Approval Pending" }));

    await waitFor(() =>
      expect(mockedListSanctionedStrengthRegister).toHaveBeenLastCalledWith(
        expect.objectContaining({ approval_status: "APPROVAL_PENDING", offset: 0 }),
      ),
    );
  });

  it("re-fetches with recruitment_status and resets pagination to page 0 when the recruitment status filter changes", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW], 120));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(mockedListSanctionedStrengthRegister).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })),
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Recruitment status filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Fully Staffed" }));

    await waitFor(() =>
      expect(mockedListSanctionedStrengthRegister).toHaveBeenLastCalledWith(
        expect.objectContaining({ recruitment_status: "FULLY_STAFFED", offset: 0 }),
      ),
    );
  });

  it("commits the search box on Enter, re-fetching with the typed text and resetting to page 0", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW], 120));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(mockedListSanctionedStrengthRegister).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })),
    );
    const callCountBeforeSearch = mockedListSanctionedStrengthRegister.mock.calls.length;

    const searchBox = screen.getByRole("textbox", { name: "Search" });
    await userEvent.type(searchBox, "computer");
    // Not committed to the query yet -- only every keystroke updates the
    // input's own value, not the server-side search param.
    expect(mockedListSanctionedStrengthRegister).toHaveBeenCalledTimes(callCountBeforeSearch);

    await userEvent.keyboard("{Enter}");

    await waitFor(() =>
      expect(mockedListSanctionedStrengthRegister).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "computer", offset: 0 }),
      ),
    );
  });

  it("commits the search box on blur, re-fetching with the typed text", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW]));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    const searchBox = screen.getByRole("textbox", { name: "Search" });
    await userEvent.type(searchBox, "mech");
    await userEvent.tab();

    await waitFor(() =>
      expect(mockedListSanctionedStrengthRegister).toHaveBeenLastCalledWith(expect.objectContaining({ search: "mech" })),
    );
  });

  it("defaults to Active-only, sending is_active: true on first load", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW]));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    expect(mockedListSanctionedStrengthRegister).toHaveBeenLastCalledWith(expect.objectContaining({ is_active: true }));
  });

  it("shows an Inactive badge for a deactivated department and widens to All statuses on request", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    const inactiveRow: VacancyRegisterRow = { ...MECH_ROW, is_active: false };
    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([inactiveRow], 120));

    renderPage();
    await waitFor(() => expect(screen.getByText("Mechanical Engineering")).toBeInTheDocument());
    expect(screen.getByText("Inactive")).toBeInTheDocument();

    const callCountBeforeToggle = mockedListSanctionedStrengthRegister.mock.calls.length;
    await userEvent.click(screen.getByRole("combobox", { name: "Active filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "All statuses" }));

    await waitFor(() =>
      expect(mockedListSanctionedStrengthRegister.mock.calls.length).toBeGreaterThan(callCountBeforeToggle),
    );
    expect(mockedListSanctionedStrengthRegister).toHaveBeenLastCalledWith(
      expect.objectContaining({ is_active: null, offset: 0 }),
    );
  });

  describe("expandable department row", () => {
    const BREAKDOWN_ROWS: DepartmentDesignationBreakdownRow[] = [
      {
        designation_id: "des-1",
        designation_name: "Assistant Professor",
        sanctioned_strength_id: "ss-1",
        approved: 10,
        working: 7,
        vacancy: 3,
        effective_from: "2026-08-10",
        remarks: "Existing sanction",
        location_id: null,
        location_name: null,
      },
      {
        designation_id: "des-2",
        designation_name: "Professor",
        sanctioned_strength_id: null,
        approved: 4,
        working: 4,
        vacancy: 0,
        effective_from: null,
        remarks: null,
        location_id: null,
        location_name: null,
      },
    ];

    // vi.mock() call histories aren't cleared automatically between tests
    // (no clearMocks in vite.config.ts) -- these two tests assert exact call
    // *counts* on mockedGetBreakdown (unlike the rest of this file, which
    // only ever checks the *last* call), so a fresh count per test is
    // required here specifically.
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("fetches and shows a department's breakdown only once expanded, and hides it again on collapse", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
      mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);

      renderPage();
      await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

      // Not fetched (or rendered) before any row is expanded.
      expect(mockedGetBreakdown).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole("button", { name: /Expand Computer Science/ }));

      await waitFor(() => expect(mockedGetBreakdown).toHaveBeenCalledWith("d-cse"));
      expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();
      expect(screen.getByText("Professor")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /Collapse Computer Science/ }));

      await waitFor(() => expect(screen.queryByText("Assistant Professor")).not.toBeInTheDocument());
    });

    it("no longer renders a per-row 'Raise vacancy request' link (moved into the drawer's Recruitment Status tab, Phase H)", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
      mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);

      renderPage();
      await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: /Expand Computer Science/ }));
      expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();

      // Assistant Professor has vacancy=3 -- under the old row-level link,
      // this would have shown a "Raise vacancy request" link. As of Phase H
      // that CTA lives inside SanctionedStrengthDrawer's own Recruitment
      // Status tab instead (see SanctionedStrengthDrawer.test.tsx).
      expect(screen.queryByRole("link", { name: "Raise vacancy request" })).not.toBeInTheDocument();
    });

    it("only fetches the breakdown for the expanded department, not every department in the list", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
      mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);

      renderPage();
      await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("button", { name: /Expand Computer Science/ }));
      await waitFor(() => expect(mockedGetBreakdown).toHaveBeenCalledTimes(1));

      expect(mockedGetBreakdown).toHaveBeenCalledWith("d-cse");
      expect(mockedGetBreakdown).not.toHaveBeenCalledWith("d-mech");
    });

    // Phase H (glowing-zooming-hamming.md): the old per-field Edit
    // popover/History button/Add-designation-inline-form CRUD affordances
    // collapsed into the single SanctionedStrengthDrawer trigger + Delete
    // shape -- see SanctionedStrengthDrawer.tsx's own docstring. This
    // describe block now drives that same drawer through the page's own
    // legacy rollup table entry points ("Edit"/"View" trigger, "Add
    // designation" button); the drawer's own tab-by-tab data-source
    // coverage (Recruitment/Approval Status, Audit Log, mode defaults) lives
    // in SanctionedStrengthDrawer.test.tsx instead of being re-tested here.
    describe("Sanctioned strength drawer (Phase H)", () => {
      const SANCTIONED_STRENGTH_ROW: SanctionedStrengthRead = {
        id: "ss-1",
        campus_id: "c-sse",
        department_id: "d-cse",
        designation_id: "des-1",
        category: "TEACHING",
        approved_strength: 12,
        effective_from: "2026-08-10",
        remarks: null,
        is_active: true,
        created_by_id: "u-1",
        updated_by_id: "u-1",
        created_at: "2026-08-10T00:00:00Z",
        updated_at: "2026-08-10T00:00:00Z",
      };

      async function expandCse() {
        renderPage();
        await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());
        await userEvent.click(screen.getByRole("button", { name: /Expand Computer Science/ }));
        expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();
      }

      it("PATCHes an existing row via the drawer's Strength tab, sending all three fields, and re-fetches the breakdown", async () => {
        mockAuth("HR_ADMIN");
        mockCampuses();
        mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
        mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);
        mockedUpdateSanctionedStrength.mockResolvedValue(SANCTIONED_STRENGTH_ROW);

        await expandCse();

        // "Edit sanctioned strength for Assistant Professor" is the single
        // drawer-trigger's exact accessible name for a write-role user --
        // exact match deliberately, since "Professor" alone is ambiguous
        // with the other row's "...for Professor" trigger.
        await userEvent.click(
          screen.getByRole("button", { name: "Edit sanctioned strength for Assistant Professor" }),
        );
        // Defaults to the Basic Info tab for a write-role user.
        expect(await screen.findByRole("tab", { name: "Basic Info" })).toHaveAttribute("aria-selected", "true");

        await userEvent.click(await screen.findByRole("tab", { name: "Strength" }));

        // Pre-filled from the breakdown row (approved=10, effective_from=
        // 2026-08-10, remarks="Existing sanction").
        const approvedInput = screen.getByLabelText("Approved");
        expect(approvedInput).toHaveValue(10);
        const effectiveFromInput = screen.getByLabelText("Effective from");
        expect(effectiveFromInput).toHaveValue("2026-08-10");
        const remarksInput = screen.getByLabelText("Remarks");
        expect(remarksInput).toHaveValue("Existing sanction");

        await userEvent.clear(approvedInput);
        await userEvent.type(approvedInput, "12");
        await userEvent.clear(remarksInput);
        await userEvent.type(remarksInput, "Revised headcount");

        await userEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() =>
          expect(mockedUpdateSanctionedStrength).toHaveBeenCalledWith("ss-1", {
            approved_strength: 12,
            effective_from: "2026-08-10",
            remarks: "Revised headcount",
            location_id: null,
          }),
        );
        // Invalidation triggers a second breakdown fetch for the same department.
        await waitFor(() => expect(mockedGetBreakdown.mock.calls.length).toBeGreaterThan(1));
      });

      it("rejects a non-numeric/negative Approved value, disabling Save and never calling the API", async () => {
        mockAuth("HR_ADMIN");
        mockCampuses();
        mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
        mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);

        await expandCse();

        await userEvent.click(
          screen.getByRole("button", { name: "Edit sanctioned strength for Assistant Professor" }),
        );
        await userEvent.click(await screen.findByRole("tab", { name: "Strength" }));
        const approvedInput = await screen.findByLabelText("Approved");
        await userEvent.clear(approvedInput);
        await userEvent.type(approvedInput, "-5");

        expect(screen.getByText("Enter a whole number, 0 or more.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

        expect(mockedUpdateSanctionedStrength).not.toHaveBeenCalled();
        expect(mockedCreateSanctionedStrength).not.toHaveBeenCalled();
      });

      it("Cancel discards the draft and closes the drawer without calling the API", async () => {
        mockAuth("HR_ADMIN");
        mockCampuses();
        mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
        mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);

        await expandCse();

        await userEvent.click(
          screen.getByRole("button", { name: "Edit sanctioned strength for Assistant Professor" }),
        );
        await userEvent.click(await screen.findByRole("tab", { name: "Strength" }));
        const approvedInput = await screen.findByLabelText("Approved");
        await userEvent.clear(approvedInput);
        await userEvent.type(approvedInput, "99");

        await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(screen.queryByLabelText("Approved")).not.toBeInTheDocument();
        expect(mockedUpdateSanctionedStrength).not.toHaveBeenCalled();
        expect(mockedCreateSanctionedStrength).not.toHaveBeenCalled();

        // Re-opening shows the original (unchanged) value, not the
        // discarded "99" draft -- confirms Cancel didn't mutate local state
        // either, only closed the drawer.
        await userEvent.click(
          screen.getByRole("button", { name: "Edit sanctioned strength for Assistant Professor" }),
        );
        await userEvent.click(await screen.findByRole("tab", { name: "Strength" }));
        expect(await screen.findByLabelText("Approved")).toHaveValue(10);
      });

      it("POSTs a brand-new row when editing a designation with no sanctioned_strength_id yet", async () => {
        mockAuth("HR_ADMIN");
        mockCampuses();
        mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
        mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);
        mockedCreateSanctionedStrength.mockResolvedValue({ ...SANCTIONED_STRENGTH_ROW, id: "ss-2", designation_id: "des-2" });

        await expandCse();
        expect(screen.getByText("Professor")).toBeInTheDocument();

        // The trigger still opens (in "edit" mode) even though this
        // designation has never been sanctioned yet -- same as the legacy
        // popover's own behavior for a null sanctioned_strength_id row.
        await userEvent.click(screen.getByRole("button", { name: "Edit sanctioned strength for Professor" }));
        await userEvent.click(await screen.findByRole("tab", { name: "Strength" }));
        // Never sanctioned yet (sanctioned_strength_id === null) -- still
        // pre-fills from whatever the breakdown row's own approved/remarks
        // are (4 / null here), effective_from just falls back to today
        // since the row's own effective_from is null.
        const approvedInput = await screen.findByLabelText("Approved");
        expect(approvedInput).toHaveValue(4);
        const remarksInput = screen.getByLabelText("Remarks");
        expect(remarksInput).toHaveValue("");

        await userEvent.clear(approvedInput);
        await userEvent.type(approvedInput, "6");
        await userEvent.type(remarksInput, "New line");

        await userEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() =>
          expect(mockedCreateSanctionedStrength).toHaveBeenCalledWith(
            expect.objectContaining({
              campus_id: "c-sse",
              department_id: "d-cse",
              designation_id: "des-2",
              approved_strength: 6,
              remarks: "New line",
            }),
          ),
        );
        // effective_from defaults to today's ISO date (not asserted exactly
        // to avoid a flaky hardcoded date).
        const call = mockedCreateSanctionedStrength.mock.calls[0][0];
        expect(call.effective_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it("shows a single 'View' trigger (not Edit), Add designation, and Delete hidden for a non-write role", async () => {
        mockAuth("CAMPUS_HOD");
        mockCampuses();
        mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
        mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);

        await expandCse();

        expect(
          screen.queryByRole("button", { name: "Edit sanctioned strength for Assistant Professor" }),
        ).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Add designation" })).not.toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: /Delete sanctioned strength for Assistant Professor/ }),
        ).not.toBeInTheDocument();
        // The single trigger is still present, just labeled/gated read-only.
        expect(
          screen.getByRole("button", { name: "View sanctioned strength for Assistant Professor" }),
        ).toBeInTheDocument();
      });

      it("Add designation: opens the drawer in Add mode and submits a POST with the selected designation, category-filtered and excluding rows already shown", async () => {
        mockAuth("HR_ADMIN");
        mockCampuses();
        mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
        mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);
        const newDesignation: DesignationRead = {
          id: "des-3",
          name: "Associate Professor",
          category: "TEACHING",
          qualification: "PhD",
          min_experience: "5+ years",
          employment_type: "FULL_TIME",
          is_active: true,
          department_ids: ["d-cse"],
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        };
        const nonTeaching: DesignationRead = {
          id: "des-4",
          name: "Lab Assistant",
          category: "NON_TEACHING",
          qualification: "BSc",
          min_experience: "1+ years",
          employment_type: "FULL_TIME",
          is_active: true,
          department_ids: ["d-cse"],
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        };
        mockedListDesignations.mockResolvedValue([newDesignation, nonTeaching]);
        mockedCreateSanctionedStrength.mockResolvedValue({ ...SANCTIONED_STRENGTH_ROW, id: "ss-3", designation_id: "des-3" });

        await expandCse();

        await userEvent.click(screen.getByRole("button", { name: "Add designation" }));
        // Add mode defaults to the Basic Info tab too (a write-role action).
        expect(await screen.findByRole("combobox", { name: "Designation" })).toBeInTheDocument();

        await userEvent.click(screen.getByRole("combobox", { name: "Designation" }));
        // Category-filtered: the NON_TEACHING designation is never offered
        // for a TEACHING department, and the already-present Assistant
        // Professor/Professor rows aren't offered again.
        expect(screen.queryByRole("option", { name: "Lab Assistant" })).not.toBeInTheDocument();
        expect(screen.queryByRole("option", { name: "Assistant Professor" })).not.toBeInTheDocument();
        await userEvent.click(await screen.findByRole("option", { name: "Associate Professor" }));

        await userEvent.click(await screen.findByRole("tab", { name: "Strength" }));
        const approvedInput = await screen.findByLabelText("Approved");
        await userEvent.clear(approvedInput);
        await userEvent.type(approvedInput, "5");

        await userEvent.click(screen.getByRole("button", { name: "Add" }));

        await waitFor(() =>
          expect(mockedCreateSanctionedStrength).toHaveBeenCalledWith(
            expect.objectContaining({
              campus_id: "c-sse",
              department_id: "d-cse",
              designation_id: "des-3",
              approved_strength: 5,
            }),
          ),
        );
      });

      it("Delete: confirms via dialog and calls DELETE", async () => {
        mockAuth("HR_ADMIN");
        mockCampuses();
        mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
        mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);
        mockedDeleteSanctionedStrength.mockResolvedValue(undefined);

        await expandCse();

        await userEvent.click(
          screen.getByRole("button", { name: /Delete sanctioned strength for Assistant Professor/ }),
        );
        await userEvent.click(await screen.findByRole("button", { name: "Confirm delete" }));

        await waitFor(() => expect(mockedDeleteSanctionedStrength).toHaveBeenCalledWith("ss-1"));
      });

      it("Delete: surfaces the backend's 409 message inline in the dialog, not a generic failure", async () => {
        mockAuth("HR_ADMIN");
        mockCampuses();
        mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
        mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);
        mockedDeleteSanctionedStrength.mockRejectedValue(
          new ApiError(409, "3 active employee(s) in this designation, cannot delete."),
        );

        await expandCse();

        await userEvent.click(
          screen.getByRole("button", { name: /Delete sanctioned strength for Assistant Professor/ }),
        );
        const dialog = await screen.findByRole("dialog");
        await userEvent.click(within(dialog).getByRole("button", { name: "Confirm delete" }));

        expect(
          await within(dialog).findByText("3 active employee(s) in this designation, cannot delete."),
        ).toBeInTheDocument();
      });

      it("History tab: fetches and renders old -> new, changed-by, and source per entry", async () => {
        mockAuth("HR_ADMIN");
        mockCampuses();
        mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
        mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);
        const historyEntries: SanctionedStrengthHistoryRead[] = [
          {
            id: "h-2",
            sanctioned_strength_id: "ss-1",
            old_value: 8,
            new_value: 10,
            changed_by_id: "11111111-2222-3333-4444-555555555555",
            changed_at: "2026-08-05T10:00:00Z",
            source: "MANUAL",
            bulk_upload_log_id: null,
          },
          {
            id: "h-1",
            sanctioned_strength_id: "ss-1",
            old_value: null,
            new_value: 8,
            changed_by_id: "99999999-8888-7777-6666-555555555555",
            changed_at: "2026-07-01T09:00:00Z",
            source: "BULK_UPLOAD",
            bulk_upload_log_id: "bu-1",
          },
        ];
        mockedGetSanctionedStrengthHistory.mockResolvedValue({
          items: historyEntries,
          total: 2,
          limit: 50,
          offset: 0,
        });

        await expandCse();

        await userEvent.click(
          screen.getByRole("button", { name: "Edit sanctioned strength for Assistant Professor" }),
        );
        await userEvent.click(await screen.findByRole("tab", { name: "History" }));

        await waitFor(() => expect(mockedGetSanctionedStrengthHistory).toHaveBeenCalledWith("ss-1"));
        expect(await screen.findByText("8 → 10")).toBeInTheDocument();
        expect(screen.getByText("— → 8")).toBeInTheDocument();
        expect(screen.getByText("Manual")).toBeInTheDocument();
        expect(screen.getByText("Bulk Upload")).toBeInTheDocument();
        expect(screen.getByText("11111111")).toBeInTheDocument();
      });
    });
  });

  describe("Bulk upload entry point and Upload history tab (Phase F)", () => {
    it("shows the Bulk upload button and the section Tabs for a write-role user", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW]));

      renderPage();
      await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

      expect(screen.getByRole("button", { name: "Bulk upload" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Sanctioned Strength" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Upload history" })).toBeInTheDocument();
    });

    it("hides the Bulk upload button and section Tabs for a non-write role", async () => {
      mockAuth("CAMPUS_HOD");
      mockCampuses();
      mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW]));

      renderPage();
      await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

      expect(screen.queryByRole("button", { name: "Bulk upload" })).not.toBeInTheDocument();
      expect(screen.queryByRole("tab", { name: "Upload history" })).not.toBeInTheDocument();
    });

    it("switches to the Upload history tab and renders past uploads, hiding the register table", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW]));
      mockedListBulkUploads.mockResolvedValue({
        items: [
          {
            id: "bu-1",
            filename: "sanctioned-strength-batch.xlsx",
            entity_type: "SANCTIONED_STRENGTH",
            uploaded_by_id: "11111111-2222-3333-4444-555555555555",
            uploaded_at: "2026-08-10T10:00:00Z",
            rows_total: 5,
            rows_created: 3,
            rows_updated: 2,
            rows_rejected: 0,
            stored_file_object_key: "bulk-uploads/bu-1/sanctioned-strength-batch.xlsx",
            status: "COMPLETED",
            undo_deadline: new Date(Date.now() + 60_000).toISOString(),
            undone_at: null,
            undone_by_id: null,
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      });

      renderPage();
      await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("tab", { name: "Upload history" }));

      expect(await screen.findByText("sanctioned-strength-batch.xlsx")).toBeInTheDocument();
      expect(screen.queryByText("Computer Science")).not.toBeInTheDocument();
      // Phase J (glowing-zooming-hamming.md) regression fix -- this page's
      // own Upload history tab must explicitly scope to SANCTIONED_STRENGTH
      // now that Location/HousekeepingStaff batches share the same
      // underlying bulk_upload_log table, or their batches would bleed in
      // here too.
      expect(mockedListBulkUploads).toHaveBeenCalledWith(
        expect.objectContaining({ entity_type: "SANCTIONED_STRENGTH" }),
      );
    });
  });

  describe("Teaching operational view (Phase E)", () => {
    // Same reasoning as the "expandable department row" describe above --
    // vi.mock() call histories aren't cleared automatically between tests
    // (no clearMocks in vite.config.ts), and the "Edit (write role)" test
    // below asserts mockedGetBreakdown is *not* called before the Edit
    // click, which only holds with a fresh count per test.
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("defaults to the Teaching tab on a fresh page load, calling the Teaching view endpoint (not the register)", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockTeachingFilterData();
      mockedListTeachingStrengthRows.mockResolvedValue(paginatedTeaching([TEACHING_ROW_1]));

      renderPage(["/sanctioned-strength"]);

      expect(await screen.findByRole("tab", { name: /^Teaching/ })).toHaveAttribute("aria-selected", "true");
      await waitFor(() => expect(mockedListTeachingStrengthRows).toHaveBeenCalled());
      expect(screen.getByText("Assistant Professor")).toBeInTheDocument();
      // Not the old department-rollup register endpoint's own table --
      // that one never fetches when the register query is unused for
      // rendering (still fetched for CategoryTabs' own counts, but its rows
      // aren't rendered as a table body here).
      expect(screen.queryByText("Vacancy Exists")).not.toBeInTheDocument();
    });

    it("renders the KPI summary tiles from the view's own aggregate totals, including a negative vacancy_total rendered as signed (not floored or hidden)", async () => {
      // Phase K (glowing-zooming-hamming.md) -- the live UI-consistency gap
      // this phase fixes. approved_total/working_total deliberately differ
      // from a naive sum of TEACHING_ROW_1 alone (10/7) to prove these 3
      // tiles read the response's own *_total fields, not something
      // recomputed from the currently-rendered page of rows. vacancy_total
      // is negative (net overstaffed across the filtered scope) -- same
      // signed-number handling as DashboardPage.tsx's own
      // sanctioned_vacancy_total tile (DashboardPage.test.tsx's "renders a
      // negative sanctioned_vacancy_total as-is" test).
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockTeachingFilterData();
      mockedListTeachingStrengthRows.mockResolvedValue(
        paginatedTeaching(
          [TEACHING_ROW_1],
          42,
          { VACANCY_RECRUITMENT_REQUIRED: 5, FULLY_STAFFED: 30, OVERSTAFFED: 7, APPROVAL_PENDING: 0, INACTIVE: 0, ALL: 42 },
          { approved_total: 120, working_total: 124, vacancy_total: -4 },
        ),
      );

      renderPage(["/sanctioned-strength"]);
      await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

      const totalTile = getKpiTile("Total Records");
      const approvedTile = getKpiTile("Approved");
      const workingTile = getKpiTile("Working");
      const vacancyTile = getKpiTile("Vacancies");
      const fullyStaffedTile = getKpiTile("Fully Staffed");
      const recruitmentTile = getKpiTile("Recruitment Required");

      expect(within(totalTile).getByText("42")).toBeInTheDocument();
      expect(within(approvedTile).getByText("120")).toBeInTheDocument();
      expect(within(workingTile).getByText("124")).toBeInTheDocument();
      expect(within(fullyStaffedTile).getByText("30")).toBeInTheDocument();
      expect(within(recruitmentTile).getByText("5")).toBeInTheDocument();

      // The real minus sign must survive rendering on this tile specifically
      // -- signed, not floored at 0, not hidden.
      expect(within(vacancyTile).getByText("-4")).toBeInTheDocument();
      expect(within(vacancyTile).queryByText("4")).not.toBeInTheDocument();
    });

    it("renders every Teaching column inline for a row, with no expand affordance anywhere on the table", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockTeachingFilterData();
      mockedListTeachingStrengthRows.mockResolvedValue(paginatedTeaching([TEACHING_ROW_1]));

      renderPage(["/sanctioned-strength"]);
      await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

      const row = screen.getByText("Assistant Professor").closest("tr");
      expect(row).not.toBeNull();
      // Cell-indexed (not withinRow.getByText) for the plain numeric
      // columns -- Approved's own value ("10") is deliberately echoed a
      // second time in the Actions cell (TeachingRowActions' own approved
      // display next to the Edit trigger), so a bare getByText("10") scoped
      // to the row is ambiguous. Column order matches TeachingStrengthTable's
      // own COLUMNS array.
      const cells = within(row as HTMLElement).getAllByRole("cell");
      expect(cells[0]).toHaveTextContent("SSE");
      expect(cells[1]).toHaveTextContent("Computer Science");
      expect(cells[2]).toHaveTextContent("Assistant Professor");
      expect(cells[3]).toHaveTextContent("Block A");
      expect(cells[4]).toHaveTextContent("10");
      expect(cells[5]).toHaveTextContent("7");
      expect(cells[6]).toHaveTextContent("3");
      expect(cells[7]).toHaveTextContent("70%");
      expect(cells[8]).toHaveTextContent("Vacancy/Recruitment Required");
      expect(cells[9]).toHaveTextContent(new Date("2026-07-01").toLocaleDateString());

      // Every value above was visible immediately -- no chevron/expand
      // button exists anywhere on this table (unlike the old rollup table's
      // department rows).
      expect(screen.queryByRole("button", { name: /Expand/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Collapse/ })).not.toBeInTheDocument();
    });

    it("shows '—' for a null Location/Last Join/Last Resignation, and a null filled_pct as '—' too", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockTeachingFilterData();
      mockedListTeachingStrengthRows.mockResolvedValue(paginatedTeaching([TEACHING_ROW_2]));

      renderPage(["/sanctioned-strength"]);
      await waitFor(() => expect(screen.getByText("Professor")).toBeInTheDocument());

      const row = screen.getByText("Professor").closest("tr");
      const withinRow = within(row as HTMLElement);
      // location_name is null on TEACHING_ROW_2 -- rendered as "—", same as
      // the department_name/designation_name null-fallback convention.
      expect(withinRow.getAllByText("—").length).toBeGreaterThan(0);
      expect(withinRow.getByText("100%")).toBeInTheDocument();
      expect(withinRow.getByText("Fully Staffed")).toBeInTheDocument();
    });

    it("maps every backend status code to its exact intended label text", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockTeachingFilterData();
      const rows: TeachingStrengthRow[] = [
        { ...TEACHING_ROW_1, sanctioned_strength_id: "ts-a", designation_id: "des-a", designation_name: "Row A", status: "VACANCY_RECRUITMENT_REQUIRED" },
        { ...TEACHING_ROW_1, sanctioned_strength_id: "ts-b", designation_id: "des-b", designation_name: "Row B", status: "FULLY_STAFFED" },
        { ...TEACHING_ROW_1, sanctioned_strength_id: "ts-c", designation_id: "des-c", designation_name: "Row C", status: "OVERSTAFFED" },
        { ...TEACHING_ROW_1, sanctioned_strength_id: "ts-d", designation_id: "des-d", designation_name: "Row D", status: "APPROVAL_PENDING" },
        { ...TEACHING_ROW_1, sanctioned_strength_id: "ts-e", designation_id: "des-e", designation_name: "Row E", status: "INACTIVE" },
      ];
      mockedListTeachingStrengthRows.mockResolvedValue(paginatedTeaching(rows, rows.length));

      renderPage(["/sanctioned-strength"]);

      await waitFor(() => expect(screen.getByText("Row A")).toBeInTheDocument());
      // Scoped to the table (not a bare page-wide screen.getByText) --
      // Phase K's own StrengthKpiSummary row above this table renders a
      // "Fully Staffed" KPI tile label too, so an unscoped query here would
      // now match 2 elements. Exact wording per
      // app/services/sanctioned_strength_views.py's own module docstring --
      // not invented client-side.
      const table = screen.getByRole("table");
      expect(within(table).getByText("Vacancy/Recruitment Required")).toBeInTheDocument();
      expect(within(table).getByText("Fully Staffed")).toBeInTheDocument();
      expect(within(table).getByText("Overstaffed")).toBeInTheDocument();
      expect(within(table).getByText("Approval Pending")).toBeInTheDocument();
      expect(within(table).getByText("Inactive")).toBeInTheDocument();
    });

    it("wires Department/Designation/Location/Status/Vacancy filters and column sorting to the real endpoint's query params", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockTeachingFilterData();
      mockedListTeachingStrengthRows.mockResolvedValue(paginatedTeaching([TEACHING_ROW_1]));

      renderPage(["/sanctioned-strength"]);
      await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("combobox", { name: "Department filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "Computer Science" }));
      await waitFor(() =>
        expect(mockedListTeachingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ department_id: "d-cse", offset: 0 }),
        ),
      );

      await userEvent.click(screen.getByRole("combobox", { name: "Designation filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "Assistant Professor" }));
      await waitFor(() =>
        expect(mockedListTeachingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ designation_id: "des-1", offset: 0 }),
        ),
      );

      await userEvent.click(screen.getByRole("combobox", { name: "Location filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "Block A" }));
      await waitFor(() =>
        expect(mockedListTeachingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ location_id: "loc-1", offset: 0 }),
        ),
      );

      await userEvent.click(screen.getByRole("combobox", { name: "Status filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "Overstaffed" }));
      await waitFor(() =>
        expect(mockedListTeachingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ status: "OVERSTAFFED", offset: 0 }),
        ),
      );

      const vacancyInput = screen.getByRole("spinbutton", { name: "Vacancy filter" });
      await userEvent.type(vacancyInput, "3");
      await userEvent.keyboard("{Enter}");
      await waitFor(() =>
        expect(mockedListTeachingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ vacancy: 3, offset: 0 }),
        ),
      );

      const approvedHeader = screen.getByRole("columnheader", { name: /^Approved/ });
      expect(approvedHeader).toHaveAttribute("aria-sort", "none");

      await userEvent.click(screen.getByRole("button", { name: /^Approved/ }));
      await waitFor(() =>
        expect(mockedListTeachingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ sort_by: "approved", sort_dir: "asc", offset: 0 }),
        ),
      );
      await waitFor(() => expect(approvedHeader).toHaveAttribute("aria-sort", "ascending"));

      await userEvent.click(screen.getByRole("button", { name: /^Approved/ }));
      await waitFor(() =>
        expect(mockedListTeachingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ sort_by: "approved", sort_dir: "desc", offset: 0 }),
        ),
      );
    }, 10000);

    it("commits the search box on Enter, re-fetching with the typed text and resetting to page 0", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockTeachingFilterData();
      mockedListTeachingStrengthRows.mockResolvedValue(paginatedTeaching([TEACHING_ROW_1], 120));

      renderPage(["/sanctioned-strength"]);
      await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("button", { name: "Next" }));
      await waitFor(() =>
        expect(mockedListTeachingStrengthRows).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })),
      );

      const searchBox = screen.getByRole("textbox", { name: "Search" });
      await userEvent.type(searchBox, "computer");
      await userEvent.keyboard("{Enter}");

      await waitFor(() =>
        expect(mockedListTeachingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: "computer", offset: 0 }),
        ),
      );
    });

    it("shows a single 'View' trigger (not Edit) and hides Delete for a non-write role; no per-row Raise vacancy request link", async () => {
      mockAuth("CAMPUS_HOD");
      mockCampuses();
      mockTeachingFilterData();
      mockedListTeachingStrengthRows.mockResolvedValue(paginatedTeaching([TEACHING_ROW_1]));

      renderPage(["/sanctioned-strength"]);
      await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

      expect(
        screen.queryByRole("button", { name: "Edit sanctioned strength for Assistant Professor" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Delete sanctioned strength for Assistant Professor/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "View sanctioned strength for Assistant Professor" }),
      ).toBeInTheDocument();

      // Phase H: "Raise vacancy request" moved inside the drawer's own
      // Recruitment Status tab -- no longer a row-level link, regardless of
      // vacancy (TEACHING_ROW_1 has vacancy=3).
      expect(screen.queryByRole("link", { name: "Raise vacancy request" })).not.toBeInTheDocument();
    });

    it("Edit (write role): opens the drawer defaulting to Basic Info, and PATCHes the true effective_from/remarks from the Strength tab", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockTeachingFilterData();
      mockedListTeachingStrengthRows.mockResolvedValue(paginatedTeaching([TEACHING_ROW_1]));
      mockedGetBreakdown.mockResolvedValue([
        {
          designation_id: "des-1",
          designation_name: "Assistant Professor",
          sanctioned_strength_id: "ts-1",
          approved: 10,
          working: 7,
          vacancy: 3,
          effective_from: "2026-05-01",
          remarks: "Original remark",
          location_id: null,
          location_name: null,
        },
      ]);
      mockedUpdateSanctionedStrength.mockResolvedValue({
        id: "ts-1",
        campus_id: "c-sse",
        department_id: "d-cse",
        designation_id: "des-1",
        category: "TEACHING",
        approved_strength: 12,
        effective_from: "2026-05-01",
        remarks: "Original remark",
        is_active: true,
        created_by_id: "u-1",
        updated_by_id: "u-1",
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-05-01T00:00:00Z",
      });

      renderPage(["/sanctioned-strength"]);
      await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

      expect(mockedGetBreakdown).not.toHaveBeenCalled();

      await userEvent.click(
        screen.getByRole("button", { name: "Edit sanctioned strength for Assistant Professor" }),
      );
      expect(await screen.findByRole("tab", { name: "Basic Info" })).toHaveAttribute("aria-selected", "true");

      await userEvent.click(screen.getByRole("tab", { name: "Strength" }));

      await waitFor(() => expect(mockedGetBreakdown).toHaveBeenCalledWith("d-cse"));

      // Pre-filled with the *fetched* effective_from/remarks, not a blind
      // today's-date/blank default -- the drawer fetches the department
      // breakdown itself specifically to avoid the data-loss bug where Save
      // would otherwise silently overwrite a real historical effective_from
      // with today's date (see SanctionedStrengthDrawer.tsx's own docstring).
      const effectiveFromInput = await screen.findByLabelText("Effective from");
      expect(effectiveFromInput).toHaveValue("2026-05-01");
      expect(screen.getByLabelText("Remarks")).toHaveValue("Original remark");

      const approvedInput = screen.getByLabelText("Approved");
      await userEvent.clear(approvedInput);
      await userEvent.type(approvedInput, "12");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(mockedUpdateSanctionedStrength).toHaveBeenCalledWith("ts-1", {
          approved_strength: 12,
          effective_from: "2026-05-01",
          remarks: "Original remark",
          location_id: null,
        }),
      );
    });

    it("Delete: refetches this view's own query (not just the legacy register) so the row actually disappears -- regression test for a real live bug", async () => {
      // Live-reported bug (2026-08-17): deleting from this dedicated Teaching
      // view succeeded server-side but the row never disappeared, because
      // DeleteSanctionedStrengthDialog only invalidated the legacy rollup
      // table's own query keys (sanctioned-strength-breakdown/-register),
      // never this view's own `teaching-strength-view` key. Fixed by
      // threading StrengthRowActions' existing onSaved callback into the
      // dialog's new onDeleted prop -- this test proves the row is gone
      // after a real refetch, not just that the API call fired.
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockTeachingFilterData();
      mockedListTeachingStrengthRows.mockResolvedValueOnce(paginatedTeaching([TEACHING_ROW_1]));
      mockedDeleteSanctionedStrength.mockResolvedValue(undefined);

      renderPage(["/sanctioned-strength"]);
      await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

      // Once the row is actually deleted, a real refetch would return the
      // empty view -- this is what proves the invalidation fired, not just
      // that the DELETE call was made.
      mockedListTeachingStrengthRows.mockResolvedValueOnce(paginatedTeaching([]));

      await userEvent.click(
        screen.getByRole("button", { name: "Delete sanctioned strength for Assistant Professor" }),
      );
      await userEvent.click(await screen.findByRole("button", { name: "Confirm delete" }));

      await waitFor(() => expect(mockedDeleteSanctionedStrength).toHaveBeenCalledWith("ts-1"));
      // The bug this regresses against: without the fix, this assertion
      // times out because mockedListTeachingStrengthRows is never called a
      // second time and "Assistant Professor" never leaves the screen.
      await waitFor(() => expect(mockedListTeachingStrengthRows).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByText("Assistant Professor")).not.toBeInTheDocument());
    });

    it("shows a genuine 'no designations found' empty state when no filters are active, and a filters-narrowed variant otherwise", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockTeachingFilterData();
      mockedListTeachingStrengthRows.mockResolvedValue(paginatedTeaching([]));

      renderPage(["/sanctioned-strength"]);

      expect(await screen.findByText("No sanctioned Teaching designations found.")).toBeInTheDocument();

      mockedListTeachingStrengthRows.mockResolvedValue(paginatedTeaching([TEACHING_ROW_1]));
      await userEvent.click(screen.getByRole("combobox", { name: "Status filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "Overstaffed" }));
      await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

      mockedListTeachingStrengthRows.mockResolvedValue(paginatedTeaching([]));
      await userEvent.click(screen.getByRole("combobox", { name: "Status filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "Inactive" }));

      expect(await screen.findByText("No designations match these filters.")).toBeInTheDocument();
    });
  });

  describe("Non-Teaching operational view (Phase F)", () => {
    // Same vi.clearAllMocks() reasoning as the Teaching describe block above.
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("renders NonTeachingStrengthTable and calls its own view endpoint (not the register) when the Non-Teaching tab is selected", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockNonTeachingFilterData();
      mockedListNonTeachingStrengthRows.mockResolvedValue(paginatedNonTeaching([NON_TEACHING_ROW_1]));

      renderPage(["/sanctioned-strength?category=non-teaching"]);

      expect(await screen.findByRole("tab", { name: /^Non-Teaching/ })).toHaveAttribute("aria-selected", "true");
      await waitFor(() => expect(mockedListNonTeachingStrengthRows).toHaveBeenCalled());
      expect(screen.getByText("Office Assistant")).toBeInTheDocument();
      // Neither the old rollup register's own rows nor the Teaching view's
      // endpoint should be involved on this tab.
      expect(mockedListTeachingStrengthRows).not.toHaveBeenCalled();
    });

    it("renders the KPI summary tiles from the view's own aggregate totals (Phase K)", async () => {
      // Sibling of Teaching's own version of this test above -- same
      // approved_total/working_total/vacancy_total wiring, a positive
      // (real, unmet) vacancy_total here for variety (Teaching's and
      // Housekeeping's own versions cover the negative "net overstaffed"
      // case).
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockNonTeachingFilterData();
      mockedListNonTeachingStrengthRows.mockResolvedValue(
        paginatedNonTeaching(
          [NON_TEACHING_ROW_1],
          18,
          { VACANCY_RECRUITMENT_REQUIRED: 6, FULLY_STAFFED: 10, OVERSTAFFED: 2, APPROVAL_PENDING: 0, INACTIVE: 0, ALL: 18 },
          { approved_total: 50, working_total: 41, vacancy_total: 9 },
        ),
      );

      renderPage(["/sanctioned-strength?category=non-teaching"]);
      await waitFor(() => expect(screen.getByText("Office Assistant")).toBeInTheDocument());

      expect(within(getKpiTile("Total Records")).getByText("18")).toBeInTheDocument();
      expect(within(getKpiTile("Approved")).getByText("50")).toBeInTheDocument();
      expect(within(getKpiTile("Working")).getByText("41")).toBeInTheDocument();
      expect(within(getKpiTile("Vacancies")).getByText("9")).toBeInTheDocument();
      expect(within(getKpiTile("Fully Staffed")).getByText("10")).toBeInTheDocument();
      expect(within(getKpiTile("Recruitment Required")).getByText("6")).toBeInTheDocument();
    });

    it("renders the Non-Teaching column set inline (now at parity with Teaching's own Last Join/Resignation/Updated columns), with a leading expand chevron and Block resolved from the joined location", async () => {
      // Column count/order updated 2026-08-17: Non-Teaching used to
      // deliberately omit Last Join/Last Resignation/Last Updated (a Phase F
      // scope-narrowing decision) -- a live report found this read as a real
      // inconsistency against Teaching's own fuller set, and the backend has
      // always returned all 3 fields for Non-Teaching rows too (same base
      // row shape as Teaching), so this is a pure display-layer parity fix,
      // not a new feature. Still no Campus/filled_pct columns -- those
      // remain genuinely out of scope for this view.
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockNonTeachingFilterData();
      mockedListNonTeachingStrengthRows.mockResolvedValue(paginatedNonTeaching([NON_TEACHING_ROW_1]));

      renderPage(["/sanctioned-strength?category=non-teaching"]);
      await waitFor(() => expect(screen.getByText("Office Assistant")).toBeInTheDocument());

      const row = screen.getByText("Office Assistant").closest("tr");
      expect(row).not.toBeNull();
      // cells[0] is the leading chevron cell (no text). Column order matches
      // NonTeachingStrengthTable's own COLUMNS array.
      const cells = within(row as HTMLElement).getAllByRole("cell");
      expect(cells).toHaveLength(13);
      expect(cells[1]).toHaveTextContent("Administration");
      expect(cells[2]).toHaveTextContent("Office Assistant");
      expect(cells[3]).toHaveTextContent("B");
      expect(cells[4]).toHaveTextContent("Block B");
      expect(cells[5]).toHaveTextContent("6");
      expect(cells[6]).toHaveTextContent("4");
      expect(cells[7]).toHaveTextContent("2");
      expect(cells[8]).toHaveTextContent("Vacancy/Recruitment Required");
      expect(cells[9]).toHaveTextContent(new Date("2026-07-10").toLocaleDateString());
      expect(cells[10]).toHaveTextContent("—");
      expect(cells[11]).toHaveTextContent(new Date("2026-08-01T10:00:00Z").toLocaleDateString());

      expect(screen.getByRole("button", { name: /^Expand employees for/ })).toBeInTheDocument();
    });

    it("shows '—' for Block/Location when a row has no location_id", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockNonTeachingFilterData();
      mockedListNonTeachingStrengthRows.mockResolvedValue(paginatedNonTeaching([NON_TEACHING_ROW_2]));

      renderPage(["/sanctioned-strength?category=non-teaching"]);
      await waitFor(() => expect(screen.getByText("Librarian")).toBeInTheDocument());

      const row = screen.getByText("Librarian").closest("tr");
      const withinRow = within(row as HTMLElement);
      expect(withinRow.getAllByText("—").length).toBeGreaterThanOrEqual(2);
      expect(withinRow.getByText("Fully Staffed")).toBeInTheDocument();
    });

    it("maps every backend status code to its exact intended label text", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockNonTeachingFilterData();
      const rows: NonTeachingStrengthRow[] = [
        { ...NON_TEACHING_ROW_1, sanctioned_strength_id: "nts-a", designation_id: "des-a", designation_name: "Row A", status: "VACANCY_RECRUITMENT_REQUIRED" },
        { ...NON_TEACHING_ROW_1, sanctioned_strength_id: "nts-b", designation_id: "des-b", designation_name: "Row B", status: "FULLY_STAFFED" },
        { ...NON_TEACHING_ROW_1, sanctioned_strength_id: "nts-c", designation_id: "des-c", designation_name: "Row C", status: "OVERSTAFFED" },
        { ...NON_TEACHING_ROW_1, sanctioned_strength_id: "nts-d", designation_id: "des-d", designation_name: "Row D", status: "APPROVAL_PENDING" },
        { ...NON_TEACHING_ROW_1, sanctioned_strength_id: "nts-e", designation_id: "des-e", designation_name: "Row E", status: "INACTIVE" },
      ];
      mockedListNonTeachingStrengthRows.mockResolvedValue(paginatedNonTeaching(rows, rows.length));

      renderPage(["/sanctioned-strength?category=non-teaching"]);

      await waitFor(() => expect(screen.getByText("Row A")).toBeInTheDocument());
      // Scoped to the table -- same "Fully Staffed" collision with Phase K's
      // own StrengthKpiSummary tile label as Teaching's own version of this
      // test above.
      const table = screen.getByRole("table");
      expect(within(table).getByText("Vacancy/Recruitment Required")).toBeInTheDocument();
      expect(within(table).getByText("Fully Staffed")).toBeInTheDocument();
      expect(within(table).getByText("Overstaffed")).toBeInTheDocument();
      expect(within(table).getByText("Approval Pending")).toBeInTheDocument();
      expect(within(table).getByText("Inactive")).toBeInTheDocument();
    });

    it("wires Department/Designation/Location/Status/Vacancy filters and column sorting to the real endpoint's query params", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockNonTeachingFilterData();
      mockedListNonTeachingStrengthRows.mockResolvedValue(paginatedNonTeaching([NON_TEACHING_ROW_1]));

      renderPage(["/sanctioned-strength?category=non-teaching"]);
      await waitFor(() => expect(screen.getByText("Office Assistant")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("combobox", { name: "Department filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "Administration" }));
      await waitFor(() =>
        expect(mockedListNonTeachingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ department_id: "d-admin", offset: 0 }),
        ),
      );

      await userEvent.click(screen.getByRole("combobox", { name: "Designation filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "Office Assistant" }));
      await waitFor(() =>
        expect(mockedListNonTeachingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ designation_id: "des-10", offset: 0 }),
        ),
      );

      await userEvent.click(screen.getByRole("combobox", { name: "Location filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "Block B" }));
      await waitFor(() =>
        expect(mockedListNonTeachingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ location_id: "loc-2", offset: 0 }),
        ),
      );

      await userEvent.click(screen.getByRole("combobox", { name: "Status filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "Overstaffed" }));
      await waitFor(() =>
        expect(mockedListNonTeachingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ status: "OVERSTAFFED", offset: 0 }),
        ),
      );

      const vacancyInput = screen.getByRole("spinbutton", { name: "Vacancy filter" });
      await userEvent.type(vacancyInput, "2");
      await userEvent.keyboard("{Enter}");
      await waitFor(() =>
        expect(mockedListNonTeachingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ vacancy: 2, offset: 0 }),
        ),
      );

      const approvedHeader = screen.getByRole("columnheader", { name: /^Approved/ });
      expect(approvedHeader).toHaveAttribute("aria-sort", "none");

      await userEvent.click(screen.getByRole("button", { name: /^Approved/ }));
      await waitFor(() =>
        expect(mockedListNonTeachingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ sort_by: "approved", sort_dir: "asc", offset: 0 }),
        ),
      );
      await waitFor(() => expect(approvedHeader).toHaveAttribute("aria-sort", "ascending"));

      await userEvent.click(screen.getByRole("button", { name: /^Approved/ }));
      await waitFor(() =>
        expect(mockedListNonTeachingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ sort_by: "approved", sort_dir: "desc", offset: 0 }),
        ),
      );
    }, 10000);

    it("commits the search box on Enter, re-fetching with the typed text and resetting to page 0", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockNonTeachingFilterData();
      mockedListNonTeachingStrengthRows.mockResolvedValue(paginatedNonTeaching([NON_TEACHING_ROW_1], 120));

      renderPage(["/sanctioned-strength?category=non-teaching"]);
      await waitFor(() => expect(screen.getByText("Office Assistant")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("button", { name: "Next" }));
      await waitFor(() =>
        expect(mockedListNonTeachingStrengthRows).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })),
      );

      const searchBox = screen.getByRole("textbox", { name: "Search" });
      await userEvent.type(searchBox, "library");
      await userEvent.keyboard("{Enter}");

      await waitFor(() =>
        expect(mockedListNonTeachingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: "library", offset: 0 }),
        ),
      );
    });

    it("expands a row to lazily fetch and show its employees, keyed to that row's department/designation", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockNonTeachingFilterData();
      mockedListNonTeachingStrengthRows.mockResolvedValue(paginatedNonTeaching([NON_TEACHING_ROW_1]));
      mockedListEmployeesByDepartmentDesignation.mockResolvedValue([EMPLOYEE_1]);

      renderPage(["/sanctioned-strength?category=non-teaching"]);
      await waitFor(() => expect(screen.getByText("Office Assistant")).toBeInTheDocument());

      expect(mockedListEmployeesByDepartmentDesignation).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole("button", { name: "Expand employees for Administration Office Assistant" }));

      await waitFor(() => expect(mockedListEmployeesByDepartmentDesignation).toHaveBeenCalledWith("d-admin", "des-10"));
      expect(await screen.findByText("Priya Kumar")).toBeInTheDocument();
      expect(screen.getByText("EMP001")).toBeInTheDocument();
      expect(screen.getByText("Active")).toBeInTheDocument();

      // Collapsing removes the expanded sub-row's content again.
      await userEvent.click(screen.getByRole("button", { name: "Collapse employees for Administration Office Assistant" }));
      expect(screen.queryByText("Priya Kumar")).not.toBeInTheDocument();
    });

    it("shows an empty-employees message when the expanded department/designation has nobody currently assigned", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockNonTeachingFilterData();
      mockedListNonTeachingStrengthRows.mockResolvedValue(paginatedNonTeaching([NON_TEACHING_ROW_1]));
      mockedListEmployeesByDepartmentDesignation.mockResolvedValue([]);

      renderPage(["/sanctioned-strength?category=non-teaching"]);
      await waitFor(() => expect(screen.getByText("Office Assistant")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("button", { name: "Expand employees for Administration Office Assistant" }));

      expect(
        await screen.findByText("No employees currently assigned to this department/designation."),
      ).toBeInTheDocument();
    });

    it("shows a single 'View' trigger (not Edit) and hides Delete for a non-write role; no per-row Raise vacancy request link", async () => {
      mockAuth("CAMPUS_HOD");
      mockCampuses();
      mockNonTeachingFilterData();
      mockedListNonTeachingStrengthRows.mockResolvedValue(paginatedNonTeaching([NON_TEACHING_ROW_1]));

      renderPage(["/sanctioned-strength?category=non-teaching"]);
      await waitFor(() => expect(screen.getByText("Office Assistant")).toBeInTheDocument());

      expect(
        screen.queryByRole("button", { name: "Edit sanctioned strength for Office Assistant" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Delete sanctioned strength for Office Assistant/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "View sanctioned strength for Office Assistant" }),
      ).toBeInTheDocument();

      // Phase H: "Raise vacancy request" moved inside the drawer's own
      // Recruitment Status tab -- no longer a row-level link, regardless of
      // vacancy (NON_TEACHING_ROW_1 has vacancy=2).
      expect(screen.queryByRole("link", { name: "Raise vacancy request" })).not.toBeInTheDocument();
    });

    it("Edit (write role): opens the drawer defaulting to Basic Info, and PATCHes the true effective_from/remarks from the Strength tab", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockNonTeachingFilterData();
      mockedListNonTeachingStrengthRows.mockResolvedValue(paginatedNonTeaching([NON_TEACHING_ROW_1]));
      mockedGetBreakdown.mockResolvedValue([
        {
          designation_id: "des-10",
          designation_name: "Office Assistant",
          sanctioned_strength_id: "nts-1",
          approved: 6,
          working: 4,
          vacancy: 2,
          effective_from: "2026-04-01",
          remarks: "Original remark",
          location_id: null,
          location_name: null,
        },
      ]);
      mockedUpdateSanctionedStrength.mockResolvedValue({
        id: "nts-1",
        campus_id: "c-sse",
        department_id: "d-admin",
        designation_id: "des-10",
        category: "NON_TEACHING",
        approved_strength: 8,
        effective_from: "2026-04-01",
        remarks: "Original remark",
        is_active: true,
        created_by_id: "u-1",
        updated_by_id: "u-1",
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
      });

      renderPage(["/sanctioned-strength?category=non-teaching"]);
      await waitFor(() => expect(screen.getByText("Office Assistant")).toBeInTheDocument());

      expect(mockedGetBreakdown).not.toHaveBeenCalled();

      await userEvent.click(
        screen.getByRole("button", { name: "Edit sanctioned strength for Office Assistant" }),
      );
      expect(await screen.findByRole("tab", { name: "Basic Info" })).toHaveAttribute("aria-selected", "true");

      await userEvent.click(screen.getByRole("tab", { name: "Strength" }));

      await waitFor(() => expect(mockedGetBreakdown).toHaveBeenCalledWith("d-admin"));

      const effectiveFromInput = await screen.findByLabelText("Effective from");
      expect(effectiveFromInput).toHaveValue("2026-04-01");
      expect(screen.getByLabelText("Remarks")).toHaveValue("Original remark");

      const approvedInput = screen.getByLabelText("Approved");
      await userEvent.clear(approvedInput);
      await userEvent.type(approvedInput, "8");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(mockedUpdateSanctionedStrength).toHaveBeenCalledWith("nts-1", {
          approved_strength: 8,
          effective_from: "2026-04-01",
          remarks: "Original remark",
          location_id: null,
        }),
      );
    });

    it("Delete: refetches this view's own query (not just the legacy register) so the row actually disappears -- same regression as Teaching's own test above", async () => {
      // Same live-reported bug as Teaching's own version of this test --
      // StrengthRowActions is shared between both tables, so this proves
      // NonTeachingStrengthTable's own `onSaved` (invalidating
      // non-teaching-strength-view) reaches the Delete path too, not just Edit.
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockNonTeachingFilterData();
      mockedListNonTeachingStrengthRows.mockResolvedValueOnce(paginatedNonTeaching([NON_TEACHING_ROW_1]));
      mockedDeleteSanctionedStrength.mockResolvedValue(undefined);

      renderPage(["/sanctioned-strength?category=non-teaching"]);
      await waitFor(() => expect(screen.getByText("Office Assistant")).toBeInTheDocument());

      mockedListNonTeachingStrengthRows.mockResolvedValueOnce(paginatedNonTeaching([]));

      await userEvent.click(
        screen.getByRole("button", { name: "Delete sanctioned strength for Office Assistant" }),
      );
      await userEvent.click(await screen.findByRole("button", { name: "Confirm delete" }));

      await waitFor(() => expect(mockedDeleteSanctionedStrength).toHaveBeenCalledWith("nts-1"));
      await waitFor(() => expect(mockedListNonTeachingStrengthRows).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByText("Office Assistant")).not.toBeInTheDocument());
    });

    it("shows a genuine 'no designations found' empty state when no filters are active, and a filters-narrowed variant otherwise", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockNonTeachingFilterData();
      mockedListNonTeachingStrengthRows.mockResolvedValue(paginatedNonTeaching([]));

      renderPage(["/sanctioned-strength?category=non-teaching"]);

      expect(await screen.findByText("No sanctioned Non-Teaching designations found.")).toBeInTheDocument();

      mockedListNonTeachingStrengthRows.mockResolvedValue(paginatedNonTeaching([NON_TEACHING_ROW_1]));
      await userEvent.click(screen.getByRole("combobox", { name: "Status filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "Overstaffed" }));
      await waitFor(() => expect(screen.getByText("Office Assistant")).toBeInTheDocument());

      mockedListNonTeachingStrengthRows.mockResolvedValue(paginatedNonTeaching([]));
      await userEvent.click(screen.getByRole("combobox", { name: "Status filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "Inactive" }));

      expect(await screen.findByText("No designations match these filters.")).toBeInTheDocument();
    });
  });

  describe("Housekeeping operational view (Phase G)", () => {
    // Same vi.clearAllMocks() reasoning as the Teaching/Non-Teaching describe
    // blocks above.
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("renders HousekeepingStrengthTable and calls its own view endpoint (not the register) when the Housekeeping tab is selected", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockHousekeepingFilterData();
      mockedListHousekeepingStrengthRows.mockResolvedValue(paginatedHousekeeping([HOUSEKEEPING_ROW_1]));

      renderPage(["/sanctioned-strength?category=housekeeping"]);

      expect(await screen.findByRole("tab", { name: /^Housekeeping/ })).toHaveAttribute("aria-selected", "true");
      await waitFor(() => expect(mockedListHousekeepingStrengthRows).toHaveBeenCalled());
      expect(screen.getByText("Central Library")).toBeInTheDocument();
      // Neither the old rollup register's own rows nor Teaching/Non-Teaching's
      // own endpoints should be involved on this tab.
      expect(mockedListTeachingStrengthRows).not.toHaveBeenCalled();
      expect(mockedListNonTeachingStrengthRows).not.toHaveBeenCalled();
    });

    it("renders the KPI summary tiles with Required/Available labels and a negative vacancy_total rendered as signed (not floored or hidden)", async () => {
      // Phase K -- Housekeeping's own variant ("REQUIRED_AVAILABLE") of
      // Teaching's/Non-Teaching's version of this test above. vacancy_total
      // here is `required_total - available_total` per
      // HousekeepingStrengthListResponse's own documented derivation --
      // NOT the sum of each row's own floored `vacancy` (HOUSEKEEPING_ROW_1's
      // own row-level vacancy is 2, positive, yet the view-level total below
      // is deliberately negative to prove this tile reads the response's own
      // vacancy_total field, not something recomputed from row data).
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockHousekeepingFilterData();
      mockedListHousekeepingStrengthRows.mockResolvedValue(
        paginatedHousekeeping(
          [HOUSEKEEPING_ROW_1],
          25,
          { VACANCY_RECRUITMENT_REQUIRED: 8, FULLY_STAFFED: 14, OVERSTAFFED: 3, APPROVAL_PENDING: 0, INACTIVE: 0, ALL: 25 },
          { required_total: 60, available_total: 64, vacancy_total: -4 },
        ),
      );

      renderPage(["/sanctioned-strength?category=housekeeping"]);
      await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());

      expect(within(getKpiTile("Total Records")).getByText("25")).toBeInTheDocument();
      expect(within(getKpiTile("Required")).getByText("60")).toBeInTheDocument();
      expect(within(getKpiTile("Available")).getByText("64")).toBeInTheDocument();
      expect(within(getKpiTile("Fully Staffed")).getByText("14")).toBeInTheDocument();
      expect(within(getKpiTile("Recruitment Required")).getByText("8")).toBeInTheDocument();

      const vacancyTile = getKpiTile("Vacancies");
      expect(within(vacancyTile).getByText("-4")).toBeInTheDocument();
      expect(within(vacancyTile).queryByText("4")).not.toBeInTheDocument();
    });

    it("renders the Location/Block/Floor-Venue/Required/Available/Vacancy/Shift/Status columns inline, with a leading expand chevron and NO Department/Designation column anywhere", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockHousekeepingFilterData();
      mockedListHousekeepingStrengthRows.mockResolvedValue(paginatedHousekeeping([HOUSEKEEPING_ROW_1]));

      renderPage(["/sanctioned-strength?category=housekeeping"]);
      await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());

      // No "Department"/"Designation" column header exists anywhere on this
      // table -- HousekeepingStrengthRow carries neither field (see
      // api/types.ts's own docstring) -- a live-verify-worthy acceptance
      // criterion per the plan, asserted here directly against the DOM.
      expect(screen.queryByRole("columnheader", { name: /Department/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("columnheader", { name: /Designation/ })).not.toBeInTheDocument();

      const row = screen.getByText("Central Library").closest("tr");
      expect(row).not.toBeNull();
      // cells[0] is the leading chevron cell (no text).
      const cells = within(row as HTMLElement).getAllByRole("cell");
      expect(cells[1]).toHaveTextContent("Central Library");
      expect(cells[2]).toHaveTextContent("Block A");
      expect(cells[3]).toHaveTextContent("Ground Floor");
      expect(cells[4]).toHaveTextContent("5");
      expect(cells[5]).toHaveTextContent("3");
      expect(cells[6]).toHaveTextContent("2");
      // shifts: ["EVENING", "MORNING"] -- rendered as separate badges,
      // sorted as the backend already sorts them (see
      // app/services/sanctioned_strength_views.py's own docstring).
      expect(within(cells[7]).getByText("Evening")).toBeInTheDocument();
      expect(within(cells[7]).getByText("Morning")).toBeInTheDocument();
      expect(cells[8]).toHaveTextContent("Vacancy/Recruitment Required");

      expect(screen.getByRole("button", { name: /^Expand roster for/ })).toBeInTheDocument();
    });

    it("renders '—' for the Shift column when a location's roster is empty (shifts: [])", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockHousekeepingFilterData();
      mockedListHousekeepingStrengthRows.mockResolvedValue(paginatedHousekeeping([HOUSEKEEPING_ROW_2]));

      renderPage(["/sanctioned-strength?category=housekeeping"]);
      await waitFor(() => expect(screen.getByText("Admin Block")).toBeInTheDocument());

      const row = screen.getByText("Admin Block").closest("tr");
      const withinRow = within(row as HTMLElement);
      expect(withinRow.getAllByText("—").length).toBeGreaterThanOrEqual(3); // Block, Floor/Venue, Shift
    });

    it("shows OVERSTAFFED status while vacancy still reads the FLOORED value (0), never negative", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockHousekeepingFilterData();
      // required=2, available=6 -- raw_vacancy is -4, but the row's own
      // vacancy field is floored at 0 while status still reads OVERSTAFFED
      // (see app/services/sanctioned_strength_views.py's own docstring,
      // Phase G judgment call #2).
      mockedListHousekeepingStrengthRows.mockResolvedValue(paginatedHousekeeping([HOUSEKEEPING_ROW_2]));

      renderPage(["/sanctioned-strength?category=housekeeping"]);
      await waitFor(() => expect(screen.getByText("Admin Block")).toBeInTheDocument());

      const row = screen.getByText("Admin Block").closest("tr");
      const withinRow = within(row as HTMLElement);
      const cells = withinRow.getAllByRole("cell");
      expect(cells[4]).toHaveTextContent("2"); // Required
      expect(cells[5]).toHaveTextContent("6"); // Available
      expect(cells[6]).toHaveTextContent("0"); // Vacancy -- floored, not -4
      expect(withinRow.getByText("Overstaffed")).toBeInTheDocument();
    });

    it("maps every backend status code to its exact intended label text", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockHousekeepingFilterData();
      const rows: HousekeepingStrengthRow[] = [
        { ...HOUSEKEEPING_ROW_1, location_id: "loc-a", location_name: "Row A", status: "VACANCY_RECRUITMENT_REQUIRED" },
        { ...HOUSEKEEPING_ROW_1, location_id: "loc-b", location_name: "Row B", status: "FULLY_STAFFED" },
        { ...HOUSEKEEPING_ROW_1, location_id: "loc-c", location_name: "Row C", status: "OVERSTAFFED" },
        { ...HOUSEKEEPING_ROW_1, location_id: "loc-d", location_name: "Row D", status: "APPROVAL_PENDING" },
        { ...HOUSEKEEPING_ROW_1, location_id: "loc-e", location_name: "Row E", status: "INACTIVE" },
      ];
      mockedListHousekeepingStrengthRows.mockResolvedValue(paginatedHousekeeping(rows, rows.length));

      renderPage(["/sanctioned-strength?category=housekeeping"]);

      await waitFor(() => expect(screen.getByText("Row A")).toBeInTheDocument());
      // Scoped to the table -- same "Fully Staffed" collision with Phase K's
      // own StrengthKpiSummary tile label as Teaching/Non-Teaching's own
      // versions of this test above.
      const table = screen.getByRole("table");
      expect(within(table).getByText("Vacancy/Recruitment Required")).toBeInTheDocument();
      expect(within(table).getByText("Fully Staffed")).toBeInTheDocument();
      expect(within(table).getByText("Overstaffed")).toBeInTheDocument();
      expect(within(table).getByText("Approval Pending")).toBeInTheDocument();
      expect(within(table).getByText("Inactive")).toBeInTheDocument();
    });

    it("wires Location/Block/Shift/Status/Vacancy filters and column sorting to the real endpoint's query params", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockHousekeepingFilterData();
      mockedListHousekeepingStrengthRows.mockResolvedValue(paginatedHousekeeping([HOUSEKEEPING_ROW_1]));

      renderPage(["/sanctioned-strength?category=housekeeping"]);
      await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("combobox", { name: "Location filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "Central Library" }));
      await waitFor(() =>
        expect(mockedListHousekeepingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ location_id: "loc-hk-1", offset: 0 }),
        ),
      );

      const blockInput = screen.getByRole("textbox", { name: "Block filter" });
      await userEvent.type(blockInput, "Block A");
      await userEvent.keyboard("{Enter}");
      await waitFor(() =>
        expect(mockedListHousekeepingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ block: "Block A", offset: 0 }),
        ),
      );

      await userEvent.click(screen.getByRole("combobox", { name: "Shift filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "Morning" }));
      await waitFor(() =>
        expect(mockedListHousekeepingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ shift: "MORNING", offset: 0 }),
        ),
      );

      await userEvent.click(screen.getByRole("combobox", { name: "Status filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "Overstaffed" }));
      await waitFor(() =>
        expect(mockedListHousekeepingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ status: "OVERSTAFFED", offset: 0 }),
        ),
      );

      const vacancyInput = screen.getByRole("spinbutton", { name: "Vacancy filter" });
      await userEvent.type(vacancyInput, "2");
      await userEvent.keyboard("{Enter}");
      await waitFor(() =>
        expect(mockedListHousekeepingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ vacancy: 2, offset: 0 }),
        ),
      );

      const requiredHeader = screen.getByRole("columnheader", { name: /^Required/ });
      expect(requiredHeader).toHaveAttribute("aria-sort", "none");

      await userEvent.click(screen.getByRole("button", { name: /^Required/ }));
      await waitFor(() =>
        expect(mockedListHousekeepingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ sort_by: "required", sort_dir: "asc", offset: 0 }),
        ),
      );
      await waitFor(() => expect(requiredHeader).toHaveAttribute("aria-sort", "ascending"));

      await userEvent.click(screen.getByRole("button", { name: /^Required/ }));
      await waitFor(() =>
        expect(mockedListHousekeepingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ sort_by: "required", sort_dir: "desc", offset: 0 }),
        ),
      );
    }, 10000);

    it("commits the search box on Enter, re-fetching with the typed text and resetting to page 0", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockHousekeepingFilterData();
      mockedListHousekeepingStrengthRows.mockResolvedValue(paginatedHousekeeping([HOUSEKEEPING_ROW_1], 120));

      renderPage(["/sanctioned-strength?category=housekeeping"]);
      await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("button", { name: "Next" }));
      await waitFor(() =>
        expect(mockedListHousekeepingStrengthRows).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })),
      );

      const searchBox = screen.getByRole("textbox", { name: "Search" });
      await userEvent.type(searchBox, "library");
      await userEvent.keyboard("{Enter}");

      await waitFor(() =>
        expect(mockedListHousekeepingStrengthRows).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: "library", offset: 0 }),
        ),
      );
    });

    it("expands a location to lazily fetch and show its real HousekeepingStaff roster (not mock data), with Edit/Delete per entry for a write role", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockHousekeepingFilterData();
      mockedListHousekeepingStrengthRows.mockResolvedValue(paginatedHousekeeping([HOUSEKEEPING_ROW_1]));
      mockedListHousekeepingStaffByLocation.mockResolvedValue([HOUSEKEEPING_STAFF_1]);

      renderPage(["/sanctioned-strength?category=housekeeping"]);
      await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());

      expect(mockedListHousekeepingStaffByLocation).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole("button", { name: "Expand roster for Central Library" }));

      await waitFor(() => expect(mockedListHousekeepingStaffByLocation).toHaveBeenCalledWith("loc-hk-1"));
      expect(await screen.findByText("BIO-100")).toBeInTheDocument();
      expect(screen.getByText("Kamala Devi")).toBeInTheDocument();
      expect(screen.getByText("Cleaner")).toBeInTheDocument();
      expect(screen.getByText("Ramesh")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Delete housekeeping staff Kamala Devi" })).toBeInTheDocument();

      // Collapsing removes the expanded sub-row's content again.
      await userEvent.click(screen.getByRole("button", { name: "Collapse roster for Central Library" }));
      expect(screen.queryByText("Kamala Devi")).not.toBeInTheDocument();
    });

    it("Delete (roster row): confirms via dialog and calls DELETE /housekeeping-staff/{id}", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockHousekeepingFilterData();
      mockedListHousekeepingStrengthRows.mockResolvedValue(paginatedHousekeeping([HOUSEKEEPING_ROW_1]));
      mockedListHousekeepingStaffByLocation.mockResolvedValue([HOUSEKEEPING_STAFF_1]);
      mockedDeleteHousekeepingStaff.mockResolvedValue(undefined);

      renderPage(["/sanctioned-strength?category=housekeeping"]);
      await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("button", { name: "Expand roster for Central Library" }));
      expect(await screen.findByText("Kamala Devi")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Delete housekeeping staff Kamala Devi" }));
      await userEvent.click(await screen.findByRole("button", { name: "Confirm delete" }));

      await waitFor(() => expect(mockedDeleteHousekeepingStaff).toHaveBeenCalledWith("hk-staff-1"));
    });

    it("shows an empty-roster message when the expanded location has nobody currently assigned, and hides Edit/Delete for a non-write role", async () => {
      mockAuth("CAMPUS_HOD");
      mockCampuses();
      mockHousekeepingFilterData();
      mockedListHousekeepingStrengthRows.mockResolvedValue(paginatedHousekeeping([HOUSEKEEPING_ROW_1]));
      mockedListHousekeepingStaffByLocation.mockResolvedValue([]);

      renderPage(["/sanctioned-strength?category=housekeeping"]);
      await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("button", { name: "Expand roster for Central Library" }));

      expect(
        await screen.findByText("No housekeeping staff currently at this location."),
      ).toBeInTheDocument();
    });

    it("hides Edit/Delete on a populated roster for a non-write role", async () => {
      mockAuth("CAMPUS_HOD");
      mockCampuses();
      mockHousekeepingFilterData();
      mockedListHousekeepingStrengthRows.mockResolvedValue(paginatedHousekeeping([HOUSEKEEPING_ROW_1]));
      mockedListHousekeepingStaffByLocation.mockResolvedValue([HOUSEKEEPING_STAFF_1]);

      renderPage(["/sanctioned-strength?category=housekeeping"]);
      await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("button", { name: "Expand roster for Central Library" }));
      expect(await screen.findByText("Kamala Devi")).toBeInTheDocument();

      expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Delete housekeeping staff Kamala Devi" }),
      ).not.toBeInTheDocument();
      // No "Add staff" action either, per this table's own canManage gate.
      expect(screen.queryByRole("button", { name: "Add staff" })).not.toBeInTheDocument();
    });

    it("'Add staff' opens HousekeepingStaffFormDrawer pre-filled to this row's own location_id/campus_id, with the campus locked", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockHousekeepingFilterData();
      mockedListHousekeepingStrengthRows.mockResolvedValue(paginatedHousekeeping([HOUSEKEEPING_ROW_1]));
      mockedCreateHousekeepingStaff.mockResolvedValue(HOUSEKEEPING_STAFF_1);

      renderPage(["/sanctioned-strength?category=housekeeping"]);
      await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("button", { name: "Add staff" }));

      expect(await screen.findByText("Add housekeeping staff")).toBeInTheDocument();
      // Campus is locked (pre-filled from the row, not user-pickable) --
      // see HousekeepingStrengthTable's own docstring for why.
      expect(screen.queryByRole("combobox", { name: "Campus" })).not.toBeInTheDocument();
      expect(await screen.findByText("SSE")).toBeInTheDocument();

      const dialog = screen.getByRole("dialog");
      await userEvent.type(within(dialog).getByLabelText("Bio ID"), "BIO-200");
      await userEvent.type(within(dialog).getByLabelText("Name"), "New Staffer");
      await userEvent.click(within(dialog).getByRole("combobox", { name: "Designation" }));
      await userEvent.click(await screen.findByRole("option", { name: "Cleaner" }));
      await userEvent.click(within(dialog).getByRole("combobox", { name: "Shift" }));
      await userEvent.click(await screen.findByRole("option", { name: "Morning" }));

      // Scoped to the dialog -- the row's own "Add staff" trigger button
      // (behind the now-open dialog) shares the same accessible name as the
      // dialog's own submit button.
      await userEvent.click(within(dialog).getByRole("button", { name: "Add staff" }));

      await waitFor(() =>
        expect(mockedCreateHousekeepingStaff).toHaveBeenCalledWith(
          expect.objectContaining({ campus_id: "c-sse", location_id: "loc-hk-1" }),
        ),
      );
    }, 10000);

    it("shows a genuine 'no locations found' empty state when no filters are active, and a filters-narrowed variant otherwise", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockHousekeepingFilterData();
      mockedListHousekeepingStrengthRows.mockResolvedValue(paginatedHousekeeping([]));

      renderPage(["/sanctioned-strength?category=housekeeping"]);

      expect(await screen.findByText("No sanctioned Housekeeping locations found.")).toBeInTheDocument();

      mockedListHousekeepingStrengthRows.mockResolvedValue(paginatedHousekeeping([HOUSEKEEPING_ROW_1]));
      await userEvent.click(screen.getByRole("combobox", { name: "Status filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "Overstaffed" }));
      await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());

      mockedListHousekeepingStrengthRows.mockResolvedValue(paginatedHousekeeping([]));
      await userEvent.click(screen.getByRole("combobox", { name: "Status filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "Inactive" }));

      expect(await screen.findByText("No locations match these filters.")).toBeInTheDocument();
    });
  });
});
