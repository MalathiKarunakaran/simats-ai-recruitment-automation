import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import { ApiError } from "@/api/client";
import type { PaginatedResponse, UserRead, UserRole, VacancyRegisterRow } from "@/api/types";
import * as vacancyRegisterApi from "@/api/vacancyRegister";
import * as authContext from "@/auth/AuthContext";
import { VacancyRegisterPage } from "@/pages/VacancyRegisterPage";

vi.mock("@/api/vacancyRegister");
vi.mock("@/api/campuses");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedListVacancyRegister = vi.mocked(vacancyRegisterApi.listVacancyRegister);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
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
  approval_status: "APPROVED",
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
  approval_status: "NO_REQUESTS",
  last_join: null,
  last_resignation: "2026-06-15",
  last_updated: "2026-07-15T09:00:00Z",
};

function paginated(items: VacancyRegisterRow[], total = items.length): PaginatedResponse<VacancyRegisterRow> {
  return { items, total, limit: 50, offset: 0 };
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
        <VacancyRegisterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("VacancyRegisterPage", () => {
  it("renders rows with column values and status badges for every enum value", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListVacancyRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));

    renderPage();

    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());
    expect(screen.getByText("Mechanical Engineering")).toBeInTheDocument();

    // CSE row: VACANCY_EXISTS / APPROVED. Scoped to a <span> (the Badge
    // element) since the sortable "Approved" column header is also a
    // clickable <button> containing the plain text "Approved", and the
    // Approval Status filter's Select also contains an "Approved" option.
    expect(screen.getByText("Vacancy Exists")).toBeInTheDocument();
    expect(screen.getByText("Approved", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();

    // MECH row: NO_ACTIVITY / NO_REQUESTS, null filled_pct.
    expect(screen.getByText("No Activity")).toBeInTheDocument();
    expect(screen.getByText("No Requests")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders the remaining recruitment/approval status enum values as badges", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    const fullyStaffed: VacancyRegisterRow = { ...CSE_ROW, department_id: "d-a", recruitment_status: "FULLY_STAFFED" };
    const overstaffed: VacancyRegisterRow = { ...CSE_ROW, department_id: "d-b", recruitment_status: "OVERSTAFFED" };
    const pending: VacancyRegisterRow = { ...CSE_ROW, department_id: "d-c", approval_status: "APPROVAL_PENDING" };
    const rejected: VacancyRegisterRow = { ...CSE_ROW, department_id: "d-d", approval_status: "REJECTED" };
    mockedListVacancyRegister.mockResolvedValue(paginated([fullyStaffed, overstaffed, pending, rejected]));

    renderPage();

    await waitFor(() => expect(screen.getByText("Fully Staffed")).toBeInTheDocument());
    expect(screen.getByText("Overstaffed")).toBeInTheDocument();
    expect(screen.getByText("Approval Pending")).toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
  });

  it("sorts by a clicked column ascending, then toggles to descending on a second click", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListVacancyRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW]));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    const approvedHeader = screen.getByRole("columnheader", { name: /Approved/ });
    expect(approvedHeader).toHaveAttribute("aria-sort", "none");

    await userEvent.click(screen.getByRole("button", { name: /Approved/ }));

    await waitFor(() =>
      expect(mockedListVacancyRegister).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort_by: "approved_count", sort_dir: "asc", offset: 0 }),
      ),
    );
    await waitFor(() => expect(approvedHeader).toHaveAttribute("aria-sort", "ascending"));

    await userEvent.click(screen.getByRole("button", { name: /Approved/ }));

    await waitFor(() =>
      expect(mockedListVacancyRegister).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort_by: "approved_count", sort_dir: "desc", offset: 0 }),
      ),
    );
    await waitFor(() => expect(approvedHeader).toHaveAttribute("aria-sort", "descending"));
  });

  it("paginates with Previous/Next, calling the API with the right offset and disabling at the boundaries", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListVacancyRegister.mockResolvedValue(paginated([CSE_ROW], 120));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    const previousButton = screen.getByRole("button", { name: "Previous" });
    const nextButton = screen.getByRole("button", { name: "Next" });
    expect(previousButton).toBeDisabled();
    expect(nextButton).not.toBeDisabled();
    expect(screen.getByText("Showing 1–50 of 120 departments")).toBeInTheDocument();

    await userEvent.click(nextButton);

    await waitFor(() =>
      expect(mockedListVacancyRegister).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })),
    );
    await waitFor(() => expect(previousButton).not.toBeDisabled());

    await userEvent.click(previousButton);

    await waitFor(() =>
      expect(mockedListVacancyRegister).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 })),
    );
  });

  it("disables Next on the last page", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListVacancyRegister.mockResolvedValue(paginated([CSE_ROW, MECH_ROW], 2));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByText("Showing 1–2 of 2 departments")).toBeInTheDocument();
  });

  it("shows a loading state", () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListVacancyRegister.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows a genuine 'no departments at all' empty state when no filters are active", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListVacancyRegister.mockResolvedValue(paginated([]));

    renderPage();

    expect(await screen.findByText("No departments found.")).toBeInTheDocument();
  });

  it("shows a filters-narrowed empty state (distinct wording) when a filter is active and the result is empty", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListVacancyRegister.mockResolvedValue(paginated([CSE_ROW]));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    mockedListVacancyRegister.mockResolvedValue(paginated([]));
    await userEvent.click(screen.getByRole("combobox", { name: "Category filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "HOUSEKEEPING" }));

    expect(await screen.findByText("No departments match these filters.")).toBeInTheDocument();
    expect(screen.queryByText("No departments found.")).not.toBeInTheDocument();
  });

  it("surfaces an ApiError message on failure", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListVacancyRegister.mockRejectedValue(new ApiError(500, "Server exploded"));

    renderPage();

    expect(await screen.findByText("Server exploded")).toBeInTheDocument();
  });

  it("shows the campus filter for a global-scope role but hides it for a single-campus role", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListVacancyRegister.mockResolvedValue(paginated([CSE_ROW]));
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
    mockedListVacancyRegister.mockResolvedValue(paginated([CSE_ROW], 120));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    // Move off page 0 first so the reset-to-0 assertion is meaningful.
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(mockedListVacancyRegister).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })),
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SCAD" }));

    await waitFor(() =>
      expect(mockedListVacancyRegister).toHaveBeenLastCalledWith(
        expect.objectContaining({ campus_code: "SCAD", offset: 0 }),
      ),
    );
  });

  it("re-fetches with category and resets pagination to page 0 when the category filter changes", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListVacancyRegister.mockResolvedValue(paginated([CSE_ROW], 120));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(mockedListVacancyRegister).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })),
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Category filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "NON TEACHING" }));

    await waitFor(() =>
      expect(mockedListVacancyRegister).toHaveBeenLastCalledWith(
        expect.objectContaining({ category: "NON_TEACHING", offset: 0 }),
      ),
    );
  });

  it("re-fetches with approval_status and resets pagination to page 0 when the approval status filter changes", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListVacancyRegister.mockResolvedValue(paginated([CSE_ROW], 120));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(mockedListVacancyRegister).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })),
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Approval status filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Approval Pending" }));

    await waitFor(() =>
      expect(mockedListVacancyRegister).toHaveBeenLastCalledWith(
        expect.objectContaining({ approval_status: "APPROVAL_PENDING", offset: 0 }),
      ),
    );
  });

  it("re-fetches with recruitment_status and resets pagination to page 0 when the recruitment status filter changes", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListVacancyRegister.mockResolvedValue(paginated([CSE_ROW], 120));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(mockedListVacancyRegister).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })),
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Recruitment status filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Fully Staffed" }));

    await waitFor(() =>
      expect(mockedListVacancyRegister).toHaveBeenLastCalledWith(
        expect.objectContaining({ recruitment_status: "FULLY_STAFFED", offset: 0 }),
      ),
    );
  });

  it("commits the search box on Enter, re-fetching with the typed text and resetting to page 0", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListVacancyRegister.mockResolvedValue(paginated([CSE_ROW], 120));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(mockedListVacancyRegister).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })),
    );
    const callCountBeforeSearch = mockedListVacancyRegister.mock.calls.length;

    const searchBox = screen.getByRole("textbox", { name: "Search" });
    await userEvent.type(searchBox, "computer");
    // Not committed to the query yet -- only every keystroke updates the
    // input's own value, not the server-side search param.
    expect(mockedListVacancyRegister).toHaveBeenCalledTimes(callCountBeforeSearch);

    await userEvent.keyboard("{Enter}");

    await waitFor(() =>
      expect(mockedListVacancyRegister).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "computer", offset: 0 }),
      ),
    );
  });

  it("commits the search box on blur, re-fetching with the typed text", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListVacancyRegister.mockResolvedValue(paginated([CSE_ROW]));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    const searchBox = screen.getByRole("textbox", { name: "Search" });
    await userEvent.type(searchBox, "mech");
    await userEvent.tab();

    await waitFor(() =>
      expect(mockedListVacancyRegister).toHaveBeenLastCalledWith(expect.objectContaining({ search: "mech" })),
    );
  });

  it("defaults to Active-only, sending is_active: true on first load", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    mockedListVacancyRegister.mockResolvedValue(paginated([CSE_ROW]));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());

    expect(mockedListVacancyRegister).toHaveBeenLastCalledWith(expect.objectContaining({ is_active: true }));
  });

  it("shows an Inactive badge for a deactivated department and widens to All statuses on request", async () => {
    mockAuth("HR_ADMIN");
    mockCampuses();
    const inactiveRow: VacancyRegisterRow = { ...MECH_ROW, is_active: false };
    mockedListVacancyRegister.mockResolvedValue(paginated([inactiveRow], 120));

    renderPage();
    await waitFor(() => expect(screen.getByText("Mechanical Engineering")).toBeInTheDocument());
    expect(screen.getByText("Inactive")).toBeInTheDocument();

    const callCountBeforeToggle = mockedListVacancyRegister.mock.calls.length;
    await userEvent.click(screen.getByRole("combobox", { name: "Active filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "All statuses" }));

    await waitFor(() =>
      expect(mockedListVacancyRegister.mock.calls.length).toBeGreaterThan(callCountBeforeToggle),
    );
    expect(mockedListVacancyRegister).toHaveBeenLastCalledWith(
      expect.objectContaining({ is_active: null, offset: 0 }),
    );
  });
});
