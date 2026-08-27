import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import * as departmentsApi from "@/api/departments";
import * as designationsApi from "@/api/designations";
import type { DesignationListResponse } from "@/api/designations";
import * as sanctionedStrengthApi from "@/api/sanctionedStrength";
import type { DepartmentRead, DesignationRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { ToastProvider } from "@/components/ui/toast";
import { DesignationsPage } from "@/pages/DesignationsPage";

vi.mock("@/api/designations");
vi.mock("@/api/departments");
vi.mock("@/api/sanctionedStrength");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListDesignationsWithCounts = vi.mocked(designationsApi.listDesignationsWithCounts);
const mockedListDepartments = vi.mocked(departmentsApi.listDepartments);
const mockedCreateDesignation = vi.mocked(designationsApi.createDesignation);
const mockedUpdateDesignation = vi.mocked(designationsApi.updateDesignation);
const mockedDeleteDesignation = vi.mocked(designationsApi.deleteDesignation);
const mockedExportDesignations = vi.mocked(designationsApi.exportDesignations);
const mockedListBulkUploads = vi.mocked(sanctionedStrengthApi.listSanctionedStrengthBulkUploads);

function mockUser(role: UserRead["role"] | null) {
  mockedUseAuth.mockReturnValue({
    user: role ? ({ role } as UserRead) : null,
    isLoading: false,
    login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
    logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
  });
}

const DEPARTMENT: DepartmentRead = {
  id: "d-1",
  campus_id: "c-sse",
  name: "Computer Science",
  code: null,
  category: "TEACHING",
  parent_group: null,
  description: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const DEPARTMENT_2: DepartmentRead = {
  id: "d-2",
  campus_id: "c-sse",
  name: "Mechanical Engineering",
  code: null,
  category: "TEACHING",
  parent_group: null,
  description: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// A NON_TEACHING department, used to prove the Edit dialog's picker filters
// by the currently-selected category.
const DEPARTMENT_3_NON_TEACHING: DepartmentRead = {
  id: "d-3",
  campus_id: "c-sse",
  name: "Library Services",
  code: null,
  category: "NON_TEACHING",
  parent_group: null,
  description: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const DESIGNATION: DesignationRead = {
  id: "des-1",
  name: "Assistant Professor",
  category: "TEACHING",
  qualification: "PhD",
  min_experience: "2+ years",
  employment_type: "FULL_TIME",
  required_skills: null,
  is_active: true,
  department_ids: ["d-1"],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const OTHER_DESIGNATION: DesignationRead = {
  id: "des-2",
  name: "Lab Assistant",
  category: "NON_TEACHING",
  qualification: "BSc",
  min_experience: "1+ years",
  employment_type: "FULL_TIME",
  required_skills: null,
  is_active: false,
  department_ids: ["d-1"],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// Builds a DesignationListResponse from a plain array, deriving
// category_counts the same way the real backend does (a per-category count
// across whatever's in `items`), unless the test needs to assert a specific
// count snapshot.
function withCounts(items: DesignationRead[], categoryCounts?: Record<string, number>): DesignationListResponse {
  return {
    items,
    total: items.length,
    limit: 200,
    offset: 0,
    category_counts: categoryCounts ?? {
      TEACHING: items.filter((d) => d.category === "TEACHING").length,
      NON_TEACHING: items.filter((d) => d.category === "NON_TEACHING").length,
      HOUSEKEEPING: items.filter((d) => d.category === "HOUSEKEEPING").length,
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
          <DesignationsPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("DesignationsPage", () => {
  it("blocks a CANDIDATE-role account from viewing the page", async () => {
    mockUser("CANDIDATE");
    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION]));
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Only staff can view the Designation Master.")).toBeInTheDocument(),
    );
  });

  it("lets a non-write staff role view designations read-only, with no write controls", async () => {
    mockUser("CAMPUS_HOD");
    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION]));
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.getByText("1 Department")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View Departments" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ New Designation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("renders designations with a color-coded CategoryBadge for a write-role (RECRUITMENT_COORDINATOR)", async () => {
    mockUser("RECRUITMENT_COORDINATOR");
    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION]));
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    // Category column now renders CategoryBadge (moved from
    // components/departments/ to components/domain/, Designation Master
    // production-hardening epic) instead of plain CATEGORY_LABELS text --
    // same TEACHING -> info/blue variant DepartmentsPage.test.tsx asserts.
    expect(screen.getByText("TEACHING")).toHaveClass("bg-brand-info/15");
    expect(screen.getByText("PhD")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ New Designation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("shows singular 'Department' for a count of one and plural 'Departments' otherwise", async () => {
    mockUser("SUPER_ADMIN");
    const twoDepartmentDesignation: DesignationRead = {
      ...OTHER_DESIGNATION,
      department_ids: ["d-1", "d-2"],
    };
    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION, twoDepartmentDesignation]));
    mockedListDepartments.mockResolvedValue([DEPARTMENT, DEPARTMENT_2]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.getByText("1 Department")).toBeInTheDocument();
    expect(screen.getByText("2 Departments")).toBeInTheDocument();
  });

  it("shows a plain dash with no View Departments link when a designation has zero linked departments", async () => {
    mockUser("SUPER_ADMIN");
    const noDepartments: DesignationRead = { ...DESIGNATION, department_ids: [] };
    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([noDepartments]));
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View Departments" })).not.toBeInTheDocument();
  });

  describe("View Departments dialog (read-only)", () => {
    it("opens on click and shows the designation name, category, count, and full department list", async () => {
      mockUser("CAMPUS_HOD");
      const twoDepartmentDesignation: DesignationRead = { ...DESIGNATION, department_ids: ["d-1", "d-2"] };
      mockedListDesignationsWithCounts.mockResolvedValue(withCounts([twoDepartmentDesignation]));
      mockedListDepartments.mockResolvedValue([DEPARTMENT, DEPARTMENT_2]);

      renderPage();
      await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("button", { name: "View Departments" }));

      expect(await screen.findByRole("heading", { name: "Assistant Professor" })).toBeInTheDocument();
      expect(screen.getByText("Departments (2)")).toBeInTheDocument();
      expect(screen.getByText("Computer Science")).toBeInTheDocument();
      expect(screen.getByText("Mechanical Engineering")).toBeInTheDocument();
      // Read-only -- no checkboxes anywhere in this dialog, even for a
      // write-capable role (see next test).
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });

    it("stays read-only (no checkboxes, never calls updateDesignation) even for a write-role user", async () => {
      mockUser("SUPER_ADMIN");
      mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION]));
      mockedListDepartments.mockResolvedValue([DEPARTMENT, DEPARTMENT_2]);
      const updateSpy = vi.mocked(designationsApi.updateDesignation);

      renderPage();
      await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("button", { name: "View Departments" }));

      expect(await screen.findByText("Computer Science")).toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("filters the department list by search, case-insensitively", async () => {
      mockUser("SUPER_ADMIN");
      const twoDepartmentDesignation: DesignationRead = { ...DESIGNATION, department_ids: ["d-1", "d-2"] };
      mockedListDesignationsWithCounts.mockResolvedValue(withCounts([twoDepartmentDesignation]));
      mockedListDepartments.mockResolvedValue([DEPARTMENT, DEPARTMENT_2]);

      renderPage();
      await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: "View Departments" }));
      await screen.findByText("Computer Science");

      await userEvent.type(screen.getByLabelText("Search departments"), "mechanical");

      expect(screen.getByText("Mechanical Engineering")).toBeInTheDocument();
      expect(screen.queryByText("Computer Science")).not.toBeInTheDocument();
    });

    it("shows a no-match message quoting the search term when nothing filters in", async () => {
      mockUser("SUPER_ADMIN");
      mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION]));
      mockedListDepartments.mockResolvedValue([DEPARTMENT]);

      renderPage();
      await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: "View Departments" }));
      await screen.findByText("Computer Science");

      await userEvent.type(screen.getByLabelText("Search departments"), "no such department");

      expect(screen.getByText('No departments match "no such department".')).toBeInTheDocument();
    });

    it("closes via the explicit Close button", async () => {
      mockUser("SUPER_ADMIN");
      mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION]));
      mockedListDepartments.mockResolvedValue([DEPARTMENT]);

      renderPage();
      await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: "View Departments" }));
      await screen.findByText("Computer Science");

      // Two "Close"-named buttons exist once the dialog is open: the
      // explicit footer Button and Radix's own top-right dismiss X (which
      // carries an sr-only "Close" label). The footer one renders first in
      // DOM order (DialogContent renders {children} before its built-in
      // Close), so it's the first match.
      await userEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);

      await waitFor(() => expect(screen.queryByText("Computer Science")).not.toBeInTheDocument());
    });
  });

  it("hides write controls for HR_ADMIN (DESIGNATION_WRITE_ROLES deliberately excludes HR_ADMIN)", async () => {
    mockUser("HR_ADMIN");
    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION]));
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "+ New Designation" })).not.toBeInTheDocument();
  });

  it("shows the empty-state message when no designations exist", async () => {
    mockUser("SUPER_ADMIN");
    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([]));
    mockedListDepartments.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText("No designations found.")).toBeInTheDocument());
  });

  describe("New/Edit designation dialog's Applicable departments picker", () => {
    it("submits a new designation with the entered fields, including a checked department", async () => {
      mockUser("SUPER_ADMIN");
      mockedListDesignationsWithCounts.mockResolvedValue(withCounts([]));
      mockedListDepartments.mockResolvedValue([DEPARTMENT]);
      mockedCreateDesignation.mockResolvedValue(DESIGNATION);

      renderPage();
      await waitFor(() => expect(screen.getByRole("button", { name: "+ New Designation" })).toBeInTheDocument());

      await userEvent.click(screen.getByRole("button", { name: "+ New Designation" }));

      await userEvent.type(screen.getByLabelText("Designation name"), "Assistant Professor");
      await userEvent.type(screen.getByLabelText("Qualification"), "PhD");
      await userEvent.type(screen.getByLabelText("Minimum experience"), "2+ years");

      await userEvent.click(screen.getByRole("button", { name: "Select departments" }));
      await userEvent.click(await screen.findByText("Computer Science"));

      await userEvent.click(screen.getByRole("button", { name: "Create designation" }));

      await waitFor(() =>
        expect(mockedCreateDesignation).toHaveBeenCalledWith({
          name: "Assistant Professor",
          category: "TEACHING",
          qualification: "PhD",
          min_experience: "2+ years",
          employment_type: "FULL_TIME",
          required_skills: null,
          is_active: true,
          department_ids: ["d-1"],
        }),
      );
    }, 15000);

    it("only offers departments matching the selected category, and drops a now-invalid selection on category switch", async () => {
      mockUser("SUPER_ADMIN");
      mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION]));
      mockedListDepartments.mockResolvedValue([DEPARTMENT, DEPARTMENT_2, DEPARTMENT_3_NON_TEACHING]);

      renderPage();
      await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

      // DESIGNATION starts TEACHING, linked only to d-1 (Computer Science).
      await userEvent.click(screen.getByRole("button", { name: "Edit" }));
      // The popover/select triggers below live directly on the DialogContent
      // (not themselves portaled), so scoping by the dialog disambiguates
      // them from anything else on the page -- but their *open* content
      // (PopoverContent/SelectContent) renders into its own top-level
      // Portal, a sibling of the dialog's portal under document.body, not a
      // descendant of it, so once opened, that content is queried globally.
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByRole("button", { name: "1 department selected" })).toBeInTheDocument();

      await userEvent.click(within(dialog).getByRole("button", { name: "1 department selected" }));
      // Only TEACHING departments are offered -- the NON_TEACHING one never
      // shows up here, even unchecked.
      expect(await screen.findByText("Computer Science")).toBeInTheDocument();
      expect(screen.getByText("Mechanical Engineering")).toBeInTheDocument();
      expect(screen.queryByText("Library Services")).not.toBeInTheDocument();
      // Close the popover before switching category.
      await userEvent.keyboard("{Escape}");

      // Switching category to NON_TEACHING drops the now-invalid d-1
      // selection back to "Select departments". The category select has no
      // aria-label of its own (unlike the page-level "Active filter"
      // select), so scope by the dialog and take the first combobox in it
      // (category is the first Select field in the form).
      await userEvent.click(within(dialog).getAllByRole("combobox")[0]);
      await userEvent.click(await screen.findByRole("option", { name: "Non-Teaching" }));

      expect(within(dialog).getByRole("button", { name: "Select departments" })).toBeInTheDocument();

      await userEvent.click(within(dialog).getByRole("button", { name: "Select departments" }));
      expect(await screen.findByText("Library Services")).toBeInTheDocument();
      expect(screen.queryByText("Computer Science")).not.toBeInTheDocument();
      expect(screen.queryByText("Mechanical Engineering")).not.toBeInTheDocument();
    });

    it("filters the picker's department list by search, case-insensitively", async () => {
      mockUser("SUPER_ADMIN");
      mockedListDesignationsWithCounts.mockResolvedValue(withCounts([]));
      mockedListDepartments.mockResolvedValue([DEPARTMENT, DEPARTMENT_2]);

      renderPage();
      await waitFor(() => expect(screen.getByRole("button", { name: "+ New Designation" })).toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: "+ New Designation" }));

      await userEvent.click(screen.getByRole("button", { name: "Select departments" }));
      await userEvent.type(screen.getByLabelText("Search departments"), "mechanical");

      expect(screen.getByText("Mechanical Engineering")).toBeInTheDocument();
      expect(screen.queryByText("Computer Science")).not.toBeInTheDocument();
    });

    it("Select all selects the full category-filtered list regardless of an active search term", async () => {
      mockUser("SUPER_ADMIN");
      mockedListDesignationsWithCounts.mockResolvedValue(withCounts([]));
      mockedListDepartments.mockResolvedValue([DEPARTMENT, DEPARTMENT_2]);

      renderPage();
      await waitFor(() => expect(screen.getByRole("button", { name: "+ New Designation" })).toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: "+ New Designation" }));

      await userEvent.click(screen.getByRole("button", { name: "Select departments" }));
      // Search narrows the visible list to one match...
      await userEvent.type(screen.getByLabelText("Search departments"), "mechanical");
      // ...but Select all still selects both TEACHING departments.
      await userEvent.click(screen.getByRole("button", { name: "Select all" }));

      expect(screen.getByRole("button", { name: "2 departments selected" })).toBeInTheDocument();
    });

    it("Clear all deselects every department", async () => {
      mockUser("SUPER_ADMIN");
      mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION]));
      mockedListDepartments.mockResolvedValue([DEPARTMENT, DEPARTMENT_2]);

      renderPage();
      await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: "Edit" }));

      await userEvent.click(await screen.findByRole("button", { name: "1 department selected" }));
      await userEvent.click(screen.getByRole("button", { name: "Clear all" }));

      expect(screen.getByRole("button", { name: "Select departments" })).toBeInTheDocument();
    });
  });

  // Designation Master production-hardening epic (backend Phase 1) -- search
  // moved server-side (was 100% client-side substring filtering before).
  // Commit-on-blur/Enter, same convention as DepartmentsPage's own search box.
  it("commits the search box on blur, re-fetching server-side with the typed text", async () => {
    mockUser("SUPER_ADMIN");
    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION, OTHER_DESIGNATION]));
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Lab Assistant")).toBeInTheDocument());

    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION]));
    await userEvent.type(screen.getByLabelText("Search designations"), "assistant prof");
    await userEvent.tab();

    await waitFor(() =>
      expect(mockedListDesignationsWithCounts).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "assistant prof" }),
      ),
    );
    expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();
    expect(screen.queryByText("Lab Assistant")).not.toBeInTheDocument();
  });

  it("re-fetches server-side when the category tab changes, combining with the active filter", async () => {
    mockUser("SUPER_ADMIN");
    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION]));
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    // Combine the category tab with the pre-existing Active filter (not
    // reset by the tab change) -- selecting Teaching then filtering by
    // Active applies both together, per this project's filter-combination
    // requirement.
    await userEvent.click(screen.getByRole("combobox", { name: "Active filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Active" }));
    await waitFor(() =>
      expect(mockedListDesignationsWithCounts).toHaveBeenLastCalledWith({ category: undefined, isActive: true }),
    );

    await userEvent.click(screen.getByRole("tab", { name: /^Non-Teaching/ }));

    await waitFor(() =>
      expect(mockedListDesignationsWithCounts).toHaveBeenLastCalledWith({
        category: "NON_TEACHING",
        isActive: true,
      }),
    );
  });

  it("renders the CategoryTabs counts from the server's category_counts snapshot", async () => {
    mockUser("SUPER_ADMIN");
    mockedListDesignationsWithCounts.mockResolvedValue(
      withCounts([DESIGNATION], { TEACHING: 12, NON_TEACHING: 3, HOUSEKEEPING: 1, ALL: 16 }),
    );
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();

    expect(await screen.findByRole("tab", { name: "All (16)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Teaching (12)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Non-Teaching (3)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Housekeeping (1)" })).toBeInTheDocument();
  });

  it("shows a distinct message when filters narrow a non-empty list to zero", async () => {
    mockUser("SUPER_ADMIN");
    mockedListDesignationsWithCounts.mockResolvedValueOnce(withCounts([DESIGNATION]));
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([]));
    await userEvent.type(screen.getByLabelText("Search designations"), "no such designation");
    await userEvent.tab();

    expect(await screen.findByText("No designations match the current filters.")).toBeInTheDocument();
    expect(screen.queryByText("No designations found.")).not.toBeInTheDocument();
  });

  it("hides Delete for a non-write staff role", async () => {
    mockUser("CAMPUS_HOD");
    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION]));
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Delete designation Assistant Professor" })).not.toBeInTheDocument();
  });

  it("deletes a designation via the confirm dialog and refreshes the list", async () => {
    mockUser("SUPER_ADMIN");
    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION]));
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedDeleteDesignation.mockResolvedValue(undefined);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Delete designation Assistant Professor" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(mockedDeleteDesignation).toHaveBeenCalledWith("des-1"));
  });

  it("surfaces the backend's exact 409 conflict message inline in the delete dialog", async () => {
    mockUser("SUPER_ADMIN");
    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION]));
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedDeleteDesignation.mockRejectedValue(
      new ApiError(409, "1 in-flight vacancy request(s) reference this designation, cannot delete."),
    );

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Delete designation Assistant Professor" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm delete" }));

    await waitFor(() =>
      expect(
        within(dialog).getByText("1 in-flight vacancy request(s) reference this designation, cannot delete."),
      ).toBeInTheDocument(),
    );
  });

  // Designation Master production-hardening epic (backend Phase 1) --
  // Department filter Select, populated from the same full department list
  // already fetched for the create/edit picker.
  it("narrows the list with the Department filter, calling the API with department_id", async () => {
    mockUser("SUPER_ADMIN");
    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION]));
    mockedListDepartments.mockResolvedValue([DEPARTMENT, DEPARTMENT_2]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "Department filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Computer Science" }));

    await waitFor(() =>
      expect(mockedListDesignationsWithCounts).toHaveBeenLastCalledWith(
        expect.objectContaining({ departmentId: "d-1" }),
      ),
    );
  });

  // Header actions reordered per the Departments follow-up spec this epic
  // mirrors: + New Designation (primary) first, then Bulk upload/Upload
  // history, then Export last.
  it("orders header actions as + New Designation, then Bulk upload/Upload history, then Export", async () => {
    mockUser("SUPER_ADMIN");
    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION]));
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "+ New Designation" })).toBeInTheDocument());

    const labels = screen.getAllByRole("button").map((button) => button.textContent);
    const newDesignationIndex = labels.indexOf("+ New Designation");
    const bulkUploadIndex = labels.indexOf("Bulk upload");
    const uploadHistoryIndex = labels.indexOf("Upload history");
    const exportIndex = labels.indexOf("Export");

    expect(newDesignationIndex).toBeGreaterThanOrEqual(0);
    expect(newDesignationIndex).toBeLessThan(bulkUploadIndex);
    expect(bulkUploadIndex).toBeLessThan(uploadHistoryIndex);
    expect(uploadHistoryIndex).toBeLessThan(exportIndex);
  });

  it("hides + New Designation, Bulk upload, and Upload history for a role without DESIGNATION_WRITE_ROLES, but still shows Export", async () => {
    mockUser("HR_ADMIN");
    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION]));
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "+ New Designation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bulk upload" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload history" })).not.toBeInTheDocument();
    // Export is gated `_staff_only` server-side (broader than
    // DESIGNATION_WRITE_ROLES) -- mirrored as an always-visible action.
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });

  it("opens the Upload history dialog scoped to DESIGNATION's own bulk-upload batches", async () => {
    mockUser("SUPER_ADMIN");
    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION]));
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListBulkUploads.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Upload history" }));

    expect(await screen.findByText("Designation bulk upload history")).toBeInTheDocument();
    await waitFor(() =>
      expect(mockedListBulkUploads).toHaveBeenCalledWith(expect.objectContaining({ entity_type: "DESIGNATION" })),
    );
  });

  it("exports designations with the current filters applied", async () => {
    mockUser("SUPER_ADMIN");
    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION]));
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedExportDesignations.mockResolvedValue(undefined);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("tab", { name: /^Teaching/ }));
    await waitFor(() =>
      expect(mockedListDesignationsWithCounts).toHaveBeenLastCalledWith(
        expect.objectContaining({ category: "TEACHING" }),
      ),
    );

    await userEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() =>
      expect(mockedExportDesignations).toHaveBeenCalledWith(expect.objectContaining({ category: "TEACHING" })),
    );
  });

  // Designation Master production-hardening epic (backend Phase 1) --
  // Restore row action for inactive designations, mutually exclusive with
  // Delete, mirroring DepartmentsPage.tsx's own DepartmentRowActions.
  it("offers Delete (not Restore) for an active designation and Restore (not Delete) for an inactive one", async () => {
    mockUser("SUPER_ADMIN");
    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([DESIGNATION, OTHER_DESIGNATION]));
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "Delete designation Assistant Professor" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore designation Assistant Professor" })).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Restore designation Lab Assistant" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete designation Lab Assistant" })).not.toBeInTheDocument();
  });

  it("restores an inactive designation via the row action, calling updateDesignation with is_active: true", async () => {
    mockUser("SUPER_ADMIN");
    mockedListDesignationsWithCounts.mockResolvedValue(withCounts([OTHER_DESIGNATION]));
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedUpdateDesignation.mockResolvedValue({ ...OTHER_DESIGNATION, is_active: true });

    renderPage();
    await waitFor(() => expect(screen.getByText("Lab Assistant")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Restore designation Lab Assistant" }));

    await waitFor(() => expect(mockedUpdateDesignation).toHaveBeenCalledWith("des-2", { is_active: true }));
  });

  // Designation gained `required_skills` (nullable free text) this epic --
  // surfaced in the create/edit form and the "View Departments" detail
  // dialog.
  describe("required_skills", () => {
    it("submits a new designation with the entered Required skills text", async () => {
      mockUser("SUPER_ADMIN");
      mockedListDesignationsWithCounts.mockResolvedValue(withCounts([]));
      mockedListDepartments.mockResolvedValue([DEPARTMENT]);
      mockedCreateDesignation.mockResolvedValue(DESIGNATION);

      renderPage();
      await waitFor(() => expect(screen.getByRole("button", { name: "+ New Designation" })).toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: "+ New Designation" }));

      await userEvent.type(screen.getByLabelText("Designation name"), "Assistant Professor");
      await userEvent.type(screen.getByLabelText("Qualification"), "PhD");
      await userEvent.type(screen.getByLabelText("Minimum experience"), "2+ years");
      await userEvent.type(screen.getByLabelText("Required skills (optional)"), "MATLAB, Python");

      await userEvent.click(screen.getByRole("button", { name: "Create designation" }));

      await waitFor(() =>
        expect(mockedCreateDesignation).toHaveBeenCalledWith(
          expect.objectContaining({ required_skills: "MATLAB, Python" }),
        ),
      );
    }, 15000);

    it("submits null when Required skills is left blank", async () => {
      mockUser("SUPER_ADMIN");
      mockedListDesignationsWithCounts.mockResolvedValue(withCounts([]));
      mockedListDepartments.mockResolvedValue([DEPARTMENT]);
      mockedCreateDesignation.mockResolvedValue(DESIGNATION);

      renderPage();
      await waitFor(() => expect(screen.getByRole("button", { name: "+ New Designation" })).toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: "+ New Designation" }));

      await userEvent.type(screen.getByLabelText("Designation name"), "Assistant Professor");
      await userEvent.type(screen.getByLabelText("Qualification"), "PhD");
      await userEvent.type(screen.getByLabelText("Minimum experience"), "2+ years");

      await userEvent.click(screen.getByRole("button", { name: "Create designation" }));

      await waitFor(() =>
        expect(mockedCreateDesignation).toHaveBeenCalledWith(expect.objectContaining({ required_skills: null })),
      );
    }, 15000);

    it("pre-fills Required skills in the Edit dialog and shows it in the View Departments dialog", async () => {
      mockUser("SUPER_ADMIN");
      const withSkills: DesignationRead = { ...DESIGNATION, required_skills: "Advanced statistics" };
      mockedListDesignationsWithCounts.mockResolvedValue(withCounts([withSkills]));
      mockedListDepartments.mockResolvedValue([DEPARTMENT]);

      renderPage();
      await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("button", { name: "View Departments" }));
      expect(await screen.findByText(/Advanced statistics/)).toBeInTheDocument();
      await userEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);

      await userEvent.click(screen.getByRole("button", { name: "Edit" }));
      expect(await screen.findByLabelText("Required skills (optional)")).toHaveValue("Advanced statistics");
    });
  });
});
