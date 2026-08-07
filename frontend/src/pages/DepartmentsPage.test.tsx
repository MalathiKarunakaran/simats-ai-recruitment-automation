import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import * as departmentsApi from "@/api/departments";
import type { CampusRead, DepartmentRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { DepartmentsPage } from "@/pages/DepartmentsPage";

vi.mock("@/api/campuses");
vi.mock("@/api/departments");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedListDepartments = vi.mocked(departmentsApi.listDepartments);
const mockedCreateDepartment = vi.mocked(departmentsApi.createDepartment);
const mockedUpdateDepartment = vi.mocked(departmentsApi.updateDepartment);

function mockUser(role: UserRead["role"]) {
  mockedUseAuth.mockReturnValue({
    user: { id: "u-1", role, campus_id: null } as UserRead,
    isLoading: false,
    login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
    logout: vi.fn(),
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
  category: "TEACHING",
  parent_group: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const HR_OFFICE: DepartmentRead = {
  ...CSE,
  id: "d-hr",
  name: "HR OFFICE",
  code: "HROFFICE",
  category: "NON_TEACHING",
  is_active: false,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DepartmentsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DepartmentsPage", () => {
  it("lists active departments with campus, code, and category", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE, SCLAS]);
    mockedListDepartments.mockResolvedValue([CSE]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());
    expect(screen.getByText("SSE")).toBeInTheDocument();
    expect(screen.getByText("CSE")).toBeInTheDocument();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
  });

  it("hides inactive departments by default, reachable via the Active filter", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([CSE, HR_OFFICE]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());
    expect(screen.queryByText("HR OFFICE")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Active filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Inactive" }));

    expect(await screen.findByText("HR OFFICE")).toBeInTheDocument();
    expect(screen.queryByText("Computer Science and Engineering")).not.toBeInTheDocument();
  });

  it("segregates departments into Teaching/Non-Teaching/Housekeeping tabs", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([CSE, { ...HR_OFFICE, is_active: true }]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());
    expect(screen.getByText("HR OFFICE")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Teaching" }));
    expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument();
    expect(screen.queryByText("HR OFFICE")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Non-Teaching" }));
    expect(screen.getByText("HR OFFICE")).toBeInTheDocument();
    expect(screen.queryByText("Computer Science and Engineering")).not.toBeInTheDocument();
  });

  it("hides New department and Edit for a role without DEPARTMENT_MANAGEMENT_ROLES", async () => {
    mockUser("CAMPUS_HOD");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([CSE]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "New department" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("creates a department with code/category/parent_group for HR Admin", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([CSE]);
    mockedCreateDepartment.mockResolvedValue({ ...CSE, id: "d-2", name: "Physics" });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "New department" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New department" }));
    await userEvent.click(screen.getAllByRole("combobox")[0]);
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));
    await userEvent.type(screen.getByLabelText("Name"), "Physics");
    await userEvent.click(screen.getByRole("button", { name: "Create department" }));

    await waitFor(() =>
      expect(mockedCreateDepartment).toHaveBeenCalledWith({
        campus_id: "c-sse",
        name: "Physics",
        code: null,
        category: null,
        parent_group: null,
        is_active: true,
      }),
    );
  });

  it("edits an existing department's name/code without changing its campus", async () => {
    mockUser("SUPER_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([CSE]);
    mockedUpdateDepartment.mockResolvedValue({ ...CSE, code: "CSE2" });

    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const codeInput = screen.getByLabelText("Code (optional)");
    await userEvent.clear(codeInput);
    await userEvent.type(codeInput, "CSE2");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mockedUpdateDepartment).toHaveBeenCalledWith("d-cse", {
        name: "Computer Science and Engineering",
        code: "CSE2",
        category: "TEACHING",
        parent_group: null,
        is_active: true,
      }),
    );
  });

  it("narrows the list with the campus filter", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE, SCLAS]);
    mockedListDepartments.mockResolvedValue([CSE, { ...HR_OFFICE, campus_id: "c-sclas", is_active: true }]);

    renderPage();
    await waitFor(() => expect(screen.getByText("HR OFFICE")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));

    expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument();
    expect(screen.queryByText("HR OFFICE")).not.toBeInTheDocument();
  });

  it("narrows the list by name search", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([CSE, { ...HR_OFFICE, campus_id: "c-sse", is_active: true }]);

    renderPage();
    await waitFor(() => expect(screen.getByText("HR OFFICE")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Search departments"), "Computer");

    expect(screen.getByText("Computer Science and Engineering")).toBeInTheDocument();
    expect(screen.queryByText("HR OFFICE")).not.toBeInTheDocument();
  });
});
