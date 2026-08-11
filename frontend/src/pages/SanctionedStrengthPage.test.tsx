import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import { ApiError } from "@/api/client";
import * as designationsApi from "@/api/designations";
import * as sanctionedStrengthApi from "@/api/sanctionedStrength";
import type { SanctionedStrengthListResponse } from "@/api/sanctionedStrength";
import type {
  DepartmentDesignationBreakdownRow,
  DesignationRead,
  SanctionedStrengthHistoryRead,
  SanctionedStrengthRead,
  UserRead,
  UserRole,
  VacancyRegisterRow,
} from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { SanctionedStrengthPage } from "@/pages/SanctionedStrengthPage";

vi.mock("@/api/sanctionedStrength");
vi.mock("@/api/campuses");
vi.mock("@/api/designations");
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
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedListDesignations = vi.mocked(designationsApi.listDesignations);
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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
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
        <MemoryRouter initialEntries={["/sanctioned-strength?department=d-cse&designation=des-1"]}>
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

    renderPage();

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

    renderPage();
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
      },
      {
        designation_id: "des-2",
        designation_name: "Professor",
        sanctioned_strength_id: null,
        approved: 4,
        working: 4,
        vacancy: 0,
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

      it("PATCHes an existing row's Approved value on Enter and re-fetches the breakdown", async () => {
        mockAuth("HR_ADMIN");
        mockCampuses();
        mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
        mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);
        mockedUpdateSanctionedStrength.mockResolvedValue(SANCTIONED_STRENGTH_ROW);

        await expandCse();

        // "Approved for Assistant Professor" is the exact accessible name
        // InlineNumberCell's edit-trigger button gets from DesignationRow's
        // own aria-label prop -- exact match deliberately, since "Professor"
        // alone is ambiguous with the other row's "Approved for Professor".
        await userEvent.click(screen.getByRole("button", { name: "Approved for Assistant Professor" }));
        const input = screen.getByRole("spinbutton", { name: "Approved for Assistant Professor value" });
        await userEvent.clear(input);
        await userEvent.type(input, "12");
        await userEvent.keyboard("{Enter}");

        await waitFor(() =>
          expect(mockedUpdateSanctionedStrength).toHaveBeenCalledWith("ss-1", { approved_strength: 12 }),
        );
        // Invalidation triggers a second breakdown fetch for the same department.
        await waitFor(() => expect(mockedGetBreakdown.mock.calls.length).toBeGreaterThan(1));
      });

      it("POSTs a brand-new row when editing a designation with no sanctioned_strength_id yet", async () => {
        mockAuth("HR_ADMIN");
        mockCampuses();
        mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
        mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);
        mockedCreateSanctionedStrength.mockResolvedValue({ ...SANCTIONED_STRENGTH_ROW, id: "ss-2", designation_id: "des-2" });

        await expandCse();
        expect(screen.getByText("Professor")).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: "Approved for Professor" }));
        const input = screen.getByRole("spinbutton", { name: "Approved for Professor value" });
        await userEvent.clear(input);
        await userEvent.type(input, "6");
        await userEvent.keyboard("{Enter}");

        await waitFor(() =>
          expect(mockedCreateSanctionedStrength).toHaveBeenCalledWith(
            expect.objectContaining({
              campus_id: "c-sse",
              department_id: "d-cse",
              designation_id: "des-2",
              approved_strength: 6,
            }),
          ),
        );
      });

      it("hides Approved-edit, Add designation, and Delete for a non-write role, but still shows History", async () => {
        mockAuth("CAMPUS_HOD");
        mockCampuses();
        mockedListSanctionedStrengthRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));
        mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);

        await expandCse();

        expect(screen.queryByRole("button", { name: "Approved for Assistant Professor" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Approved for Professor" })).not.toBeInTheDocument();
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
});
