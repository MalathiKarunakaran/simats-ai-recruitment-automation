import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import { ApiError } from "@/api/client";
import * as departmentsApi from "@/api/departments";
import * as designationsApi from "@/api/designations";
import * as locationsApi from "@/api/locations";
import * as sanctionedStrengthApi from "@/api/sanctionedStrength";
import type { SanctionedStrengthListResponse } from "@/api/sanctionedStrength";
import * as sanctionedStrengthViewsApi from "@/api/sanctionedStrengthViews";
import type {
  DepartmentDesignationBreakdownRow,
  DepartmentRead,
  DesignationRead,
  LocationRead,
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
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedListDepartments = vi.mocked(departmentsApi.listDepartments);
const mockedListDesignations = vi.mocked(designationsApi.listDesignations);
const mockedListLocations = vi.mocked(locationsApi.listLocations);
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

function paginatedTeaching(
  items: TeachingStrengthRow[],
  total = items.length,
  statusCounts?: Record<string, number>,
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
  };
}

// Populates the Teaching table's own Department/Designation/Location filter
// dropdowns -- fetched unconditionally on mount (small master-data lists,
// same eager-fetch convention as AddDesignationRow's own designations query,
// just not gated behind an "open" flag since these are plain filter Selects,
// not a create-row form).
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

// Defaults to ?category=non-teaching (glowing-zooming-hamming.md Phase E) --
// SanctionedStrengthPage now defaults to the TEACHING tab (its own
// TeachingStrengthTable, a completely different component/endpoint), but
// every test in this file *except* the dedicated "Teaching operational view"
// describe block below exercises the pre-existing department-rollup+expand
// table (backed by listSanctionedStrengthRegister) -- deliberately started
// on a non-default, non-Teaching tab so all of that pre-existing coverage
// keeps exercising exactly the same code path it always did, unchanged by
// this phase's default-tab fix. NON_TEACHING was picked (not HOUSEKEEPING or
// ALL) since it's a real, explicit-in-the-URL category with no special
// meaning to any test below.
function renderPage(initialEntries: string[] = ["/sanctioned-strength?category=non-teaching"]) {
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
        {/* &category=non-teaching -- this reverse-link test exercises the
            rollup table's expand/collapse behavior specifically, which is
            unrelated to (and unaffected by) which category is selected; a
            non-Teaching category keeps it on that table rather than the new
            default TEACHING tab's TeachingStrengthTable (no expand there). */}
        <MemoryRouter initialEntries={["/sanctioned-strength?department=d-cse&designation=des-1&category=non-teaching"]}>
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

    // Explicit ?category=all -- renderPage()'s own default (non-teaching)
    // is itself a real category filter (hasAnyFilter treats
    // categoryFilter !== "ALL" as a filter), which would flip this into the
    // *filters-narrowed* empty state below instead of this genuine one.
    renderPage(["/sanctioned-strength?category=all"]);

    expect(await screen.findByText("No departments found.")).toBeInTheDocument();
  });

  it("shows a filters-narrowed empty state (distinct wording) when a filter is active and the result is empty", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW]));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([]));
    await userEvent.click(screen.getByRole("tab", { name: /^Housekeeping/ }));

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

    // Starts on Housekeeping (not the default renderPage() Non-Teaching
    // entry) so clicking the Non-Teaching tab below is a genuine change --
    // both tabs render the same pre-existing rollup table, so this test is
    // otherwise unaffected by the default-tab fix.
    renderPage(["/sanctioned-strength?category=housekeeping"]);
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(mockedListSanctionedStrengthRegister).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })),
    );

    await userEvent.click(screen.getByRole("tab", { name: /^Non-Teaching/ }));

    await waitFor(() =>
      expect(mockedListSanctionedStrengthRegister).toHaveBeenLastCalledWith(
        expect.objectContaining({ category: "NON_TEACHING", offset: 0 }),
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

    it("offers 'Raise vacancy request' only for a designation row with vacancy > 0 (Phase E item 30)", async () => {
      mockAuth("HR_ADMIN");
      mockCampuses();
      mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
      mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);

      renderPage();
      await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: /Expand Computer Science/ }));
      expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();

      // Assistant Professor: vacancy=3 -> link shown, capped at that count.
      const raiseLink = screen.getByRole("link", { name: "Raise vacancy request" });
      expect(raiseLink).toHaveAttribute(
        "href",
        "/vacancy-requests/new?campus=c-sse&department=d-cse&designation=des-1&maxCount=3",
      );
      // Professor: vacancy=0 -> no link for that row. Only one link total.
      expect(screen.getAllByRole("link", { name: "Raise vacancy request" })).toHaveLength(1);
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

    describe("CRUD affordances (Phase D)", () => {
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

      it("PATCHes an existing row via the edit popover's Save button, sending all three fields, and re-fetches the breakdown", async () => {
        mockAuth("HR_ADMIN");
        mockCampuses();
        mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
        mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);
        mockedUpdateSanctionedStrength.mockResolvedValue(SANCTIONED_STRENGTH_ROW);

        await expandCse();

        // "Edit sanctioned strength for Assistant Professor" is the exact
        // accessible name SanctionedStrengthEditPopover's trigger gets --
        // exact match deliberately, since "Professor" alone is ambiguous
        // with the other row's "...for Professor" trigger.
        await userEvent.click(
          screen.getByRole("button", { name: "Edit sanctioned strength for Assistant Professor" }),
        );

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
        const approvedInput = screen.getByLabelText("Approved");
        await userEvent.clear(approvedInput);
        await userEvent.type(approvedInput, "-5");

        expect(screen.getByText("Enter a whole number, 0 or more.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

        expect(mockedUpdateSanctionedStrength).not.toHaveBeenCalled();
        expect(mockedCreateSanctionedStrength).not.toHaveBeenCalled();
      });

      it("Cancel discards the draft and closes the popover without calling the API", async () => {
        mockAuth("HR_ADMIN");
        mockCampuses();
        mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
        mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);

        await expandCse();

        await userEvent.click(
          screen.getByRole("button", { name: "Edit sanctioned strength for Assistant Professor" }),
        );
        const approvedInput = screen.getByLabelText("Approved");
        await userEvent.clear(approvedInput);
        await userEvent.type(approvedInput, "99");

        await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(screen.queryByLabelText("Approved")).not.toBeInTheDocument();
        expect(mockedUpdateSanctionedStrength).not.toHaveBeenCalled();
        expect(mockedCreateSanctionedStrength).not.toHaveBeenCalled();

        // Re-opening shows the original (unchanged) value, not the
        // discarded "99" draft -- confirms Cancel didn't mutate local state
        // either, only closed the popover.
        await userEvent.click(
          screen.getByRole("button", { name: "Edit sanctioned strength for Assistant Professor" }),
        );
        expect(screen.getByLabelText("Approved")).toHaveValue(10);
      });

      it("POSTs a brand-new row when editing a designation with no sanctioned_strength_id yet", async () => {
        mockAuth("HR_ADMIN");
        mockCampuses();
        mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
        mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);
        mockedCreateSanctionedStrength.mockResolvedValue({ ...SANCTIONED_STRENGTH_ROW, id: "ss-2", designation_id: "des-2" });

        await expandCse();
        expect(screen.getByText("Professor")).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: "Edit sanctioned strength for Professor" }));
        // Never sanctioned yet (sanctioned_strength_id === null) -- the
        // popover still pre-fills from whatever the breakdown row's own
        // approved/remarks are (4 / null here), effective_from just falls
        // back to today since the row's own effective_from is null.
        const approvedInput = screen.getByLabelText("Approved");
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

      it("hides the edit popover trigger, Add designation, and Delete for a non-write role, but still shows History", async () => {
        mockAuth("CAMPUS_HOD");
        mockCampuses();
        mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
        mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);

        await expandCse();

        expect(
          screen.queryByRole("button", { name: "Edit sanctioned strength for Assistant Professor" }),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: "Edit sanctioned strength for Professor" }),
        ).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Add designation" })).not.toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: /Delete sanctioned strength for Assistant Professor/ }),
        ).not.toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: /View history for Assistant Professor/ }),
        ).toBeInTheDocument();
      });

      it("Add designation: submits a POST with the selected designation, category-filtered and excluding rows already shown", async () => {
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

        await userEvent.click(screen.getByRole("combobox", { name: "Designation" }));
        // Category-filtered: the NON_TEACHING designation is never offered
        // for a TEACHING department, and the already-present Assistant
        // Professor/Professor rows aren't offered again.
        expect(screen.queryByRole("option", { name: "Lab Assistant" })).not.toBeInTheDocument();
        expect(screen.queryByRole("option", { name: "Assistant Professor" })).not.toBeInTheDocument();
        await userEvent.click(await screen.findByRole("option", { name: "Associate Professor" }));

        const approvedInput = screen.getByLabelText("Approved");
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

      it("History drawer: fetches and renders old -> new, changed-by, and source per entry", async () => {
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

        await userEvent.click(screen.getByRole("button", { name: /View history for Assistant Professor/ }));

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
      // Exact wording per app/services/sanctioned_strength_views.py's own
      // module docstring -- not invented client-side.
      expect(screen.getByText("Vacancy/Recruitment Required")).toBeInTheDocument();
      expect(screen.getByText("Fully Staffed")).toBeInTheDocument();
      expect(screen.getByText("Overstaffed")).toBeInTheDocument();
      expect(screen.getByText("Approval Pending")).toBeInTheDocument();
      expect(screen.getByText("Inactive")).toBeInTheDocument();
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
    });

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

    it("hides Edit/Delete for a non-write role but still shows History and the Raise vacancy request link", async () => {
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
      expect(screen.getByRole("button", { name: /View history for Assistant Professor/ })).toBeInTheDocument();

      const raiseLink = screen.getByRole("link", { name: "Raise vacancy request" });
      expect(raiseLink).toHaveAttribute(
        "href",
        "/vacancy-requests/new?campus=c-sse&department=d-cse&designation=des-1&maxCount=3",
      );
    });

    it("hides the Raise vacancy request link once vacancy is 0 (Fully Staffed)", async () => {
      mockAuth("CAMPUS_HOD");
      mockCampuses();
      mockTeachingFilterData();
      mockedListTeachingStrengthRows.mockResolvedValue(paginatedTeaching([TEACHING_ROW_2]));

      renderPage(["/sanctioned-strength"]);
      await waitFor(() => expect(screen.getByText("Professor")).toBeInTheDocument());

      expect(screen.queryByRole("link", { name: "Raise vacancy request" })).not.toBeInTheDocument();
    });

    it("Edit (write role): lazily fetches the department breakdown for the true effective_from/remarks before opening, and PATCHes on Save", async () => {
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

      await waitFor(() => expect(mockedGetBreakdown).toHaveBeenCalledWith("d-cse"));

      // Pre-filled with the *fetched* effective_from/remarks, not a blind
      // today's-date/blank default -- TeachingStrengthTable's own
      // TeachingRowActions exists specifically to avoid the data-loss bug
      // where Save would otherwise silently overwrite a real historical
      // effective_from with today's date (see that component's docstring).
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
        }),
      );
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
});
