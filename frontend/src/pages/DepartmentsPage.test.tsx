import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import { ApiError } from "@/api/client";
import * as departmentsApi from "@/api/departments";
import * as sanctionedStrengthApi from "@/api/sanctionedStrength";
import type { CampusRead, DepartmentListResponse, DepartmentRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { ToastProvider } from "@/components/ui/toast";
import { DepartmentsPage } from "@/pages/DepartmentsPage";

// Departments production-hardening epic, frontend Phase 2 -- rewritten from
// the old client-side-filtered version to cover server-side pagination/
// sort/filter, the bulk-upload/upload-history/export actions, the 3-dot
// row-actions Popover, and the clear-filters + two-empty-states pattern.
// Upload history dialog pulls from api/sanctionedStrength.ts too (the
// shared, entity-agnostic bulk-upload-log endpoints) -- same reuse
// LocationsPage.test.tsx already mocks for its own Upload history dialog.

vi.mock("@/api/campuses");
vi.mock("@/api/departments");
vi.mock("@/api/sanctionedStrength");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedListDepartmentsWithCounts = vi.mocked(departmentsApi.listDepartmentsWithCounts);
const mockedCreateDepartment = vi.mocked(departmentsApi.createDepartment);
const mockedUpdateDepartment = vi.mocked(departmentsApi.updateDepartment);
const mockedDeleteDepartment = vi.mocked(departmentsApi.deleteDepartment);
const mockedExportDepartments = vi.mocked(departmentsApi.exportDepartments);
const mockedListBulkUploads = vi.mocked(sanctionedStrengthApi.listSanctionedStrengthBulkUploads);
const mockedListDepartmentParentGroups = vi.mocked(departmentsApi.listDepartmentParentGroups);

function mockUser(role: UserRead["role"], hasPermission: (permission: string) => boolean = () => false) {
  mockedUseAuth.mockReturnValue({
    user: { id: "u-1", role, campus_id: null } as UserRead,
    isLoading: false,
    login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
    logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    hasPermission,
  });
}

const SSE: CampusRead = {
  id: "c-sse",
  code: "SSE",
  name: "Saveetha School of Engineering",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const SCLAS: CampusRead = { ...SSE, id: "c-sclas", code: "SCLAS" };

const CSE: DepartmentRead = {
  id: "d-cse",
  campus_id: "c-sse",
  name: "Computer Science and Engineering",
  code: "CSE",
  supported_categories: ["TEACHING"],
  parent_group: null,
  description: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const HR_OFFICE: DepartmentRead = {
  ...CSE,
  id: "d-hr",
  name: "HR OFFICE",
  code: "HROFFICE",
  supported_categories: ["NON_TEACHING"],
  is_active: false,
};

function paginated(
  items: DepartmentRead[],
  total = items.length,
  categoryCounts?: Record<string, number>,
): DepartmentListResponse {
  return {
    items,
    total,
    limit: 50,
    offset: 0,
    // Counts overlap deliberately -- a department supporting two
    // categories is counted under both, while ALL stays a distinct count.
    category_counts: categoryCounts ?? {
      TEACHING: items.filter((d) => d.supported_categories.includes("TEACHING")).length,
      NON_TEACHING: items.filter((d) => d.supported_categories.includes("NON_TEACHING")).length,
      HOUSEKEEPING: items.filter((d) => d.supported_categories.includes("HOUSEKEEPING")).length,
      ALL: items.length,
    },
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <DepartmentsPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("DepartmentsPage", () => {
  // Parent Group filter's options query -- irrelevant to most tests below,
  // defaulted here so each test doesn't need its own boilerplate mock.
  beforeEach(() => {
    mockedListDepartmentParentGroups.mockResolvedValue([]);
  });

  it("lists departments with campus, code, and category from the server response", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE, SCLAS]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));

    renderPage();

    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());
    expect(screen.getByText("SSE")).toBeInTheDocument();
    expect(screen.getByText("CSE")).toBeInTheDocument();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    // Active-only by default -- same convention as before this rewrite.
    expect(mockedListDepartmentsWithCounts).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: true, limit: 50, offset: 0, sort_by: "name", sort_dir: "asc" }),
    );
  });

  it("re-fetches with is_active: false when the Active filter is switched to Inactive", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());

    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([HR_OFFICE]));
    await userEvent.click(screen.getByRole("combobox", { name: "Active filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Inactive" }));

    expect(await screen.findByText("HR OFFICE")).toBeInTheDocument();
    await waitFor(() =>
      expect(mockedListDepartmentsWithCounts).toHaveBeenLastCalledWith(
        expect.objectContaining({ is_active: false, offset: 0 }),
      ),
    );
  });

  it("uses the server-provided category_counts for the CategoryTabs labels, not a client-computed count", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(
      paginated([CSE], 1, { TEACHING: 7, NON_TEACHING: 3, HOUSEKEEPING: 1, ALL: 11 }),
    );

    renderPage();

    // Only 1 item is actually returned/rendered, but the tab counts reflect
    // the server's own category_counts snapshot, not items.length.
    expect(await screen.findByRole("tab", { name: "All (11)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Teaching (7)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Non-Teaching (3)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Housekeeping (1)" })).toBeInTheDocument();
  });

  it("re-fetches with category: TEACHING and resets to page 0 when a CategoryTabs tab is clicked", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("tab", { name: /^Teaching/ }));

    await waitFor(() =>
      expect(mockedListDepartmentsWithCounts).toHaveBeenLastCalledWith(
        expect.objectContaining({ category: "TEACHING", offset: 0 }),
      ),
    );
  });

  it("hides New department, Bulk upload, Upload history, and the row-actions menu for a role without DEPARTMENT_MANAGEMENT_ROLES", async () => {
    mockUser("CAMPUS_HOD");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));

    renderPage();

    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "+ New Department" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bulk upload" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload history" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /More actions/ })).not.toBeInTheDocument();
  });

  it("still shows Export to a role without DEPARTMENT_MANAGEMENT_ROLES (mirrors the backend's broader staff-only export gate)", async () => {
    mockUser("CAMPUS_HOD");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));

    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument());
  });

  // RBAC permission-gate audit (2026-08-24): departments.py's create/update/
  // delete/bulk-upload are gated by require_permission(MANAGE_DEPARTMENTS),
  // not DEPARTMENT_MANAGEMENT_ROLES alone.
  it("hides New department for a CAMPUS_HOD with no MANAGE_DEPARTMENTS grant (unchanged prior behavior)", async () => {
    mockUser("CAMPUS_HOD", () => false);
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));

    renderPage();

    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "+ New Department" })).not.toBeInTheDocument();
  });

  it("shows New department, Bulk upload, and Upload history to a CAMPUS_HOD individually granted MANAGE_DEPARTMENTS", async () => {
    mockUser("CAMPUS_HOD", (permission) => permission === "MANAGE_DEPARTMENTS");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));

    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: "+ New Department" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Bulk upload" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload history" })).toBeInTheDocument();
  });

  it("opens the Upload history dialog scoped to DEPARTMENT's own bulk-upload batches", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));
    mockedListBulkUploads.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Upload history" }));

    expect(await screen.findByText("Department bulk upload history")).toBeInTheDocument();
    await waitFor(() =>
      expect(mockedListBulkUploads).toHaveBeenCalledWith(expect.objectContaining({ entity_type: "DEPARTMENT" })),
    );
  });

  // Several sequential userEvent.type() calls -- slower than the default 5s
  // test timeout in this environment (same convention as
  // VacancyRequestForm.test.tsx's own "create" test).
  it("creates a department with code/category/parent_group/description for HR Admin", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));
    mockedCreateDepartment.mockResolvedValue({ ...CSE, id: "d-2", name: "Physics" });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "+ New Department" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "+ New Department" }));
    await userEvent.click(screen.getAllByRole("combobox")[0]);
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));
    await userEvent.type(screen.getByLabelText("Name"), "Physics");
    await userEvent.type(screen.getByLabelText("Description (optional)"), "Deals with physical sciences");
    await userEvent.click(screen.getByRole("button", { name: "Create department" }));

    await waitFor(() =>
      expect(mockedCreateDepartment).toHaveBeenCalledWith({
        campus_id: "c-sse",
        name: "Physics",
        code: null,
        // The form starts on the same NON_TEACHING the backend falls back to
        // for an omitted value, so an untouched checkbox group still submits
        // a valid, non-empty set.
        supported_categories: ["NON_TEACHING"],
        parent_group: null,
        description: "Deals with physical sciences",
        is_active: true,
      }),
    );
  }, 15000);

  it("edits an existing department's name/code without changing its campus", async () => {
    mockUser("SUPER_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));
    mockedUpdateDepartment.mockResolvedValue({ ...CSE, code: "CSE2" });

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "More actions for Computer Science and Engineering" }));
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const codeInput = screen.getByLabelText("Code (optional)");
    await userEvent.clear(codeInput);
    await userEvent.type(codeInput, "CSE2");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mockedUpdateDepartment).toHaveBeenCalledWith("d-cse", {
        name: "Computer Science and Engineering",
        code: "CSE2",
        supported_categories: ["TEACHING"],
        parent_group: null,
        description: null,
        is_active: true,
      }),
    );
  }, 10000);

  it("narrows the list with the campus filter, calling the API with campus_id", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE, SCLAS]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));

    await waitFor(() =>
      expect(mockedListDepartmentsWithCounts).toHaveBeenLastCalledWith(
        expect.objectContaining({ campus_id: "c-sse", offset: 0 }),
      ),
    );
  });

  it("commits the search box on blur, re-fetching with the typed text and resetting to offset 0", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Search departments"), "Computer");
    await userEvent.tab();

    await waitFor(() =>
      expect(mockedListDepartmentsWithCounts).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "Computer", offset: 0 }),
      ),
    );
  });

  it("toggles sort direction on a column header, resetting to offset 0", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());

    const codeHeader = screen.getByRole("columnheader", { name: /^Code/ });
    expect(codeHeader).toHaveAttribute("aria-sort", "none");

    await userEvent.click(screen.getByRole("button", { name: /^Code/ }));
    await waitFor(() =>
      expect(mockedListDepartmentsWithCounts).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort_by: "code", sort_dir: "asc", offset: 0 }),
      ),
    );
    await waitFor(() => expect(codeHeader).toHaveAttribute("aria-sort", "ascending"));

    await userEvent.click(screen.getByRole("button", { name: /^Code/ }));
    await waitFor(() =>
      expect(mockedListDepartmentsWithCounts).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort_by: "code", sort_dir: "desc", offset: 0 }),
      ),
    );
    await waitFor(() => expect(codeHeader).toHaveAttribute("aria-sort", "descending"));
  });

  it("paginates with Previous/Next, calling the API with the right offset and disabling at the boundaries", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE], 120));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());

    const previousButton = screen.getByRole("button", { name: "Previous" });
    const nextButton = screen.getByRole("button", { name: "Next" });
    expect(previousButton).toBeDisabled();
    expect(nextButton).not.toBeDisabled();
    expect(screen.getByText("Showing 1–50 of 120 departments")).toBeInTheDocument();

    await userEvent.click(nextButton);

    await waitFor(() =>
      expect(mockedListDepartmentsWithCounts).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })),
    );
    await waitFor(() => expect(previousButton).not.toBeDisabled());

    await userEvent.click(previousButton);

    await waitFor(() =>
      expect(mockedListDepartmentsWithCounts).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 })),
    );
  });

  it("changes the page size via the Pagination rows-per-page selector, resetting to offset 0", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE], 120));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "Rows per page" }));
    await userEvent.click(await screen.findByRole("option", { name: "100" }));

    await waitFor(() =>
      expect(mockedListDepartmentsWithCounts).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: 100, offset: 0 }),
      ),
    );
  });

  it("shows a filter-applied indicator and a working Clear filters button once a filter is active", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());

    const clearButton = screen.getByRole("button", { name: /Clear filters/ });
    expect(clearButton).toBeDisabled();
    expect(screen.queryByText("Filters applied")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));

    expect(await screen.findByText("Filters applied")).toBeInTheDocument();
    expect(clearButton).not.toBeDisabled();

    await userEvent.click(clearButton);

    expect(screen.queryByText("Filters applied")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mockedListDepartmentsWithCounts).toHaveBeenLastCalledWith(
        expect.objectContaining({ campus_id: null, is_active: true, category: null, search: null }),
      ),
    );
  });

  it("shows a 'Clear filters' empty state when filters narrow the list to zero results", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValueOnce(paginated([CSE]));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());

    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([]));
    await userEvent.type(screen.getByLabelText("Search departments"), "Nonexistent");
    await userEvent.tab();

    expect(await screen.findByText("No departments match the current filters.")).toBeInTheDocument();
    // Two "Clear filters" buttons exist once filters are active and the
    // table is empty (the toolbar's own + the in-table empty-state one) --
    // either click drives the same clearFilters() call.
    const [, emptyStateClearButton] = screen.getAllByRole("button", { name: "Clear filters" });
    await userEvent.click(emptyStateClearButton);

    await waitFor(() =>
      expect(mockedListDepartmentsWithCounts).toHaveBeenLastCalledWith(expect.objectContaining({ search: null })),
    );
  });

  it("shows a 'New department' create CTA in the empty state when there are no filters and no departments at all", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([]));

    renderPage();

    expect(await screen.findByText("No departments found.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "+ New Department" }).length).toBeGreaterThan(0);
  });

  it("deletes a department via the 3-dot row-actions menu and refreshes the list", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));
    mockedDeleteDepartment.mockResolvedValue(undefined);

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "More actions for Computer Science and Engineering" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(mockedDeleteDepartment).toHaveBeenCalledWith("d-cse"));
  });

  it("surfaces the backend's exact 409 conflict message inline in the delete dialog", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));
    mockedDeleteDepartment.mockRejectedValue(
      new ApiError(409, "2 active user(s) reference this department, cannot delete."),
    );

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "More actions for Computer Science and Engineering" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm delete" }));

    await waitFor(() =>
      expect(within(dialog).getByText("2 active user(s) reference this department, cannot delete.")).toBeInTheDocument(),
    );
  });

  it("exports departments with the current filters applied", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));
    mockedExportDepartments.mockResolvedValue(undefined);

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));
    await waitFor(() => expect(mockedListDepartmentsWithCounts).toHaveBeenLastCalledWith(
      expect.objectContaining({ campus_id: "c-sse" }),
    ));

    await userEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() =>
      expect(mockedExportDepartments).toHaveBeenCalledWith(expect.objectContaining({ campus_id: "c-sse" })),
    );
  });

  // Departments follow-up spec, item 1 -- color-coded Category badges
  // (Badge's existing variants: TEACHING -> info/blue, NON_TEACHING ->
  // outline/brand-plum, HOUSEKEEPING -> warning/orange).
  it("renders the Category column as color-coded CategoryBadges", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(
      paginated([
        CSE,
        { ...CSE, id: "d-house", name: "Facilities", supported_categories: ["HOUSEKEEPING"] },
        HR_OFFICE,
      ]),
    );

    renderPage();

    expect(await screen.findByText("TEACHING")).toHaveClass("bg-brand-info/15");
    expect(screen.getByText("HOUSEKEEPING")).toHaveClass("bg-brand-warning/15");
    expect(screen.getByText("NON TEACHING")).toHaveClass("border-brand-plum/40");
  });

  // Departments follow-up spec, item 2 -- Parent Group filter, populated
  // from the new GET /departments/parent-groups endpoint.
  it("populates the Parent Group filter from listDepartmentParentGroups and re-fetches with it selected", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));
    mockedListDepartmentParentGroups.mockResolvedValue(["School of Engineering", "School of Sciences"]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "Parent group filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "School of Sciences" }));

    await waitFor(() =>
      expect(mockedListDepartmentsWithCounts).toHaveBeenLastCalledWith(
        expect.objectContaining({ parent_group: "School of Sciences", offset: 0 }),
      ),
    );
  });

  it("still renders a sensible Parent Group filter (just 'All parent groups') when no parent groups exist yet", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));
    mockedListDepartmentParentGroups.mockResolvedValue([]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "Parent group filter" }));
    expect(await screen.findByRole("option", { name: "All parent groups" })).toBeInTheDocument();
    expect(screen.getAllByRole("option").length).toBe(1);
  });

  // Departments follow-up spec, item 3 -- header actions reordered to New
  // Department (primary) first, then Bulk upload/Upload history, Export last.
  it("orders header actions as New Department, then Bulk upload/Upload history, then Export", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "+ New Department" })).toBeInTheDocument());

    const labels = screen.getAllByRole("button").map((button) => button.textContent);
    const newDeptIndex = labels.indexOf("+ New Department");
    const bulkUploadIndex = labels.indexOf("Bulk upload");
    const uploadHistoryIndex = labels.indexOf("Upload history");
    const exportIndex = labels.indexOf("Export");

    expect(newDeptIndex).toBeGreaterThanOrEqual(0);
    expect(newDeptIndex).toBeLessThan(bulkUploadIndex);
    expect(bulkUploadIndex).toBeLessThan(uploadHistoryIndex);
    expect(uploadHistoryIndex).toBeLessThan(exportIndex);
  });

  // Departments follow-up spec, item 7 -- Restore row action for inactive
  // departments, mutually exclusive with Delete.
  it("offers Delete (not Restore) for an active department and Restore (not Delete) for an inactive one", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE, HR_OFFICE]));

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "More actions for Computer Science and Engineering" }));
    expect(await screen.findByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("button", { name: "More actions for HR OFFICE" }));
    expect(await screen.findByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("restores an inactive department via the row-actions menu, calling updateDepartment with is_active: true", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([HR_OFFICE]));
    mockedUpdateDepartment.mockResolvedValue({ ...HR_OFFICE, is_active: true });

    renderPage();
    await waitFor(() => expect(screen.getByText("HR OFFICE")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "More actions for HR OFFICE" }));
    await userEvent.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() => expect(mockedUpdateDepartment).toHaveBeenCalledWith("d-hr", { is_active: true }));
  });

  // --- multi-valued Supported Staff Categories (2026-08-28) ------------------
  // A department is a place, not a staff category: CSE holds Assistant
  // Professors (TEACHING) and Lab Assistants (NON_TEACHING) at once.

  it("submits every ticked staff category when creating a department", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([]));
    mockedCreateDepartment.mockResolvedValue(CSE);

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "+ New Department" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "+ New Department" }));
    await userEvent.click(screen.getAllByRole("combobox")[0]);
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));
    await userEvent.type(screen.getByLabelText("Name"), "Computer Science");
    // Starts on NON_TEACHING; add TEACHING so both are submitted.
    await userEvent.click(screen.getByLabelText("TEACHING"));
    await userEvent.click(screen.getByRole("button", { name: "Create department" }));

    await waitFor(() =>
      expect(mockedCreateDepartment).toHaveBeenCalledWith(
        expect.objectContaining({ supported_categories: ["TEACHING", "NON_TEACHING"] }),
      ),
    );
  }, 15000);

  it("stores categories in canonical order however the boxes are ticked", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([]));
    mockedCreateDepartment.mockResolvedValue(CSE);

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "+ New Department" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "+ New Department" }));
    await userEvent.click(screen.getAllByRole("combobox")[0]);
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));
    await userEvent.type(screen.getByLabelText("Name"), "Facilities");
    // Untick the default, then tick out of order -- the payload should still
    // read TEACHING, HOUSEKEEPING (CATEGORIES order), not tick order.
    await userEvent.click(screen.getByLabelText("NON TEACHING"));
    await userEvent.click(screen.getByLabelText("HOUSEKEEPING"));
    await userEvent.click(screen.getByLabelText("TEACHING"));
    await userEvent.click(screen.getByRole("button", { name: "Create department" }));

    await waitFor(() =>
      expect(mockedCreateDepartment).toHaveBeenCalledWith(
        expect.objectContaining({ supported_categories: ["TEACHING", "HOUSEKEEPING"] }),
      ),
    );
  }, 15000);

  it("renders one badge per supported category, on a single row", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(
      paginated([{ ...CSE, supported_categories: ["TEACHING", "NON_TEACHING"] }]),
    );

    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument(),
    );

    // One row, not one per category -- the department is not duplicated.
    expect(screen.getAllByText("Computer Science and Engineering")).toHaveLength(1);
    const row = screen.getByText("Computer Science and Engineering").closest("tr")!;
    // Exact text, not a regex: "TEACHING" is a substring of "NON TEACHING".
    expect(within(row).getByText("TEACHING")).toBeInTheDocument();
    expect(within(row).getByText("NON TEACHING")).toBeInTheDocument();
  });

  // Reported from production 2026-08-28: ticking a second category on an
  // EXISTING department appeared to save (200 OK) but changed nothing. The
  // create path was covered; the edit path was not.
  it("adds a second staff category to an existing department from the edit dialog", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartmentsWithCounts.mockResolvedValue(paginated([CSE]));
    mockedUpdateDepartment.mockResolvedValue({
      ...CSE,
      supported_categories: ["TEACHING", "NON_TEACHING"],
    });

    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument(),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "More actions for Computer Science and Engineering" }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));

    // Prefilled from the department: TEACHING ticked, the others not.
    expect(screen.getByLabelText("TEACHING")).toBeChecked();
    expect(screen.getByLabelText("NON TEACHING")).not.toBeChecked();

    await userEvent.click(screen.getByLabelText("NON TEACHING"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mockedUpdateDepartment).toHaveBeenCalledWith(
        "d-cse",
        expect.objectContaining({ supported_categories: ["TEACHING", "NON_TEACHING"] }),
      ),
    );
  }, 15000);
});
