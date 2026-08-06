import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as departmentsApi from "@/api/departments";
import * as designationsApi from "@/api/designations";
import type { DepartmentRead, DesignationRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { DesignationsPage } from "@/pages/DesignationsPage";

vi.mock("@/api/designations");
vi.mock("@/api/departments");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListDesignations = vi.mocked(designationsApi.listDesignations);
const mockedListDepartments = vi.mocked(departmentsApi.listDepartments);
const mockedCreateDesignation = vi.mocked(designationsApi.createDesignation);

function mockUser(role: UserRead["role"] | null) {
  mockedUseAuth.mockReturnValue({
    user: role ? ({ role } as UserRead) : null,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

const DEPARTMENT: DepartmentRead = {
  id: "d-1",
  campus_id: "c-sse",
  name: "Computer Science",
  code: null,
  category: null,
  parent_group: null,
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
  is_active: false,
  department_ids: ["d-1"],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DesignationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DesignationsPage", () => {
  it("blocks a CANDIDATE-role account from viewing the page", async () => {
    mockUser("CANDIDATE");
    mockedListDesignations.mockResolvedValue([DESIGNATION]);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Only staff can view the Designation Master.")).toBeInTheDocument(),
    );
  });

  it("lets a non-write staff role view designations read-only, with no write controls", async () => {
    mockUser("CAMPUS_HOD");
    mockedListDesignations.mockResolvedValue([DESIGNATION]);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "1 department" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New designation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("renders designations with resolved department names for a write-role (RECRUITMENT_COORDINATOR)", async () => {
    mockUser("RECRUITMENT_COORDINATOR");
    mockedListDesignations.mockResolvedValue([DESIGNATION]);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.getByText("TEACHING")).toBeInTheDocument();
    expect(screen.getByText("PhD")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New designation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();

    // Department names are hidden behind a popover, not inlined into the
    // table row, so a designation linked to dozens of departments doesn't
    // turn every row into a giant wall of comma-separated text.
    await userEvent.click(screen.getByRole("button", { name: "1 department" }));
    expect(await screen.findByText("Computer Science")).toBeInTheDocument();
  });

  it("hides write controls for HR_ADMIN (DESIGNATION_WRITE_ROLES deliberately excludes HR_ADMIN)", async () => {
    mockUser("HR_ADMIN");
    mockedListDesignations.mockResolvedValue([DESIGNATION]);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "New designation" })).not.toBeInTheDocument();
  });

  it("shows the empty-state message when no designations exist", async () => {
    mockUser("SUPER_ADMIN");
    mockedListDesignations.mockResolvedValue([]);
    mockedListDepartments.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText("No designations found.")).toBeInTheDocument());
  });

  it("submits a new designation with the entered fields, including a checked department", async () => {
    mockUser("SUPER_ADMIN");
    mockedListDesignations.mockResolvedValue([]);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedCreateDesignation.mockResolvedValue(DESIGNATION);

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "New designation" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New designation" }));

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
        is_active: true,
        department_ids: ["d-1"],
      }),
    );
  }, 15000);

  it("narrows by name search client-side without an extra fetch", async () => {
    mockUser("SUPER_ADMIN");
    mockedListDesignations.mockResolvedValue([DESIGNATION, OTHER_DESIGNATION]);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Lab Assistant")).toBeInTheDocument());
    const callsBefore = mockedListDesignations.mock.calls.length;

    await userEvent.type(screen.getByLabelText("Search designations"), "assistant prof");

    expect(screen.getByText("Assistant Professor")).toBeInTheDocument();
    expect(screen.queryByText("Lab Assistant")).not.toBeInTheDocument();
    expect(mockedListDesignations.mock.calls.length).toBe(callsBefore);
  });

  it("re-fetches server-side when the category filter changes", async () => {
    mockUser("SUPER_ADMIN");
    mockedListDesignations.mockResolvedValue([DESIGNATION]);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "Category filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "NON TEACHING" }));

    await waitFor(() =>
      expect(mockedListDesignations).toHaveBeenLastCalledWith({ category: "NON_TEACHING", isActive: undefined }),
    );
  });

  it("shows a distinct message when filters narrow a non-empty list to zero", async () => {
    mockUser("SUPER_ADMIN");
    mockedListDesignations.mockResolvedValue([DESIGNATION]);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Search designations"), "no such designation");

    expect(screen.getByText("No designations match the current filters.")).toBeInTheDocument();
    expect(screen.queryByText("No designations found.")).not.toBeInTheDocument();
  });
});
