import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import * as departmentsApi from "@/api/departments";
import * as employeesApi from "@/api/employees";
import type { CampusRead, DepartmentRead, EmployeeRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { EmployeeDetailPage } from "@/pages/EmployeeDetailPage";

vi.mock("@/api/employees");
vi.mock("@/api/departments");
vi.mock("@/api/campuses");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedGetEmployee = vi.mocked(employeesApi.getEmployee);
const mockedListDepartments = vi.mocked(departmentsApi.listDepartments);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedOffboardEmployee = vi.mocked(employeesApi.offboardEmployee);
const mockedUseAuth = vi.mocked(authContext.useAuth);

function mockUser(role: UserRead["role"] | null, hasPermission: (permission: string) => boolean = () => false) {
  mockedUseAuth.mockReturnValue({
    user: role ? ({ role } as UserRead) : null,
    isLoading: false,
    login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
    logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    hasPermission,
  });
}

const CAMPUS: CampusRead = {
  id: "c-sse",
  code: "SSE",
  name: "Saveetha School of Engineering",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const DEPARTMENT: DepartmentRead = {
  id: "d-cse",
  campus_id: "c-sse",
  name: "Computer Science",
  code: null,
  category: null,
  parent_group: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const EMPLOYEE: EmployeeRead = {
  id: "emp-1",
  application_id: "app-1",
  employee_code: "SSE-0001",
  campus_id: "c-sse",
  department_id: "d-cse",
  full_name: "Jane Doe",
  email: "jane@example.com",
  phone_number: "+91 9876543210",
  designation: "Assistant Professor",
  date_of_joining: "2026-03-01",
  user_id: null,
  employment_status: "ACTIVE",
  separation_date: null,
  separation_reason: null,
  separated_by_id: null,
  created_at: "2026-01-02T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/employees/emp-1"]}>
        <Routes>
          <Route path="/employees/:id" element={<EmployeeDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("EmployeeDetailPage", () => {
  it("shows all employee fields with resolved department/campus and a link to the source application", async () => {
    mockUser("HR_ADMIN");
    mockedGetEmployee.mockResolvedValue(EMPLOYEE);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByText("jane@example.com")).toBeInTheDocument());
    expect(screen.getByText("SSE-0001")).toBeInTheDocument();
    expect(screen.getByText("Assistant Professor")).toBeInTheDocument();
    expect(screen.getByText("Computer Science")).toBeInTheDocument();
    expect(screen.getByText("SSE")).toBeInTheDocument();
    expect(screen.getByText("+91 9876543210")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "View application" });
    expect(link).toHaveAttribute("href", "/applications/app-1");
  });

  it("shows the ACTIVE status badge for an active employee", async () => {
    mockUser("HR_ADMIN");
    mockedGetEmployee.mockResolvedValue(EMPLOYEE);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByText("ACTIVE")).toBeInTheDocument());
    expect(screen.queryByText("Separation details")).not.toBeInTheDocument();
  });

  it("shows the Offboard button for HR Admin", async () => {
    mockUser("HR_ADMIN");
    mockedGetEmployee.mockResolvedValue(EMPLOYEE);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Offboard" })).toBeInTheDocument();
  });

  it("shows the Offboard button for Super Admin", async () => {
    mockUser("SUPER_ADMIN");
    mockedGetEmployee.mockResolvedValue(EMPLOYEE);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Offboard" })).toBeInTheDocument();
  });

  it("hides the Offboard button for a non-HR role", async () => {
    mockUser("CAMPUS_HOD");
    mockedGetEmployee.mockResolvedValue(EMPLOYEE);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Offboard" })).not.toBeInTheDocument();
  });

  // RBAC permission-gate audit (2026-08-24): offboard_employee is gated by
  // require_permission(EDIT_EMPLOYEES), not CAN_OFFBOARD_ROLES alone -- this
  // locks in the fix without changing the "hides the Offboard button" test
  // above (no grant passed, so behaves exactly as before).
  it("shows the Offboard button to a non-HR role individually granted EDIT_EMPLOYEES", async () => {
    mockUser("CAMPUS_HOD", (permission) => permission === "EDIT_EMPLOYEES");
    mockedGetEmployee.mockResolvedValue(EMPLOYEE);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: "Offboard" })).toBeInTheDocument());
  });

  it("shows separation details instead of the Offboard button once separated", async () => {
    mockUser("HR_ADMIN");
    mockedGetEmployee.mockResolvedValue({
      ...EMPLOYEE,
      employment_status: "RESIGNED",
      separation_date: "2026-06-01",
      separation_reason: "Took a new role elsewhere",
      separated_by_id: "u-hr-1",
    });
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Separation details")).toBeInTheDocument());
    expect(screen.getByText("Took a new role elsewhere")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Offboard" })).not.toBeInTheDocument();
  });

  it("submits an offboard request with the entered details", async () => {
    mockUser("HR_ADMIN");
    mockedGetEmployee.mockResolvedValue(EMPLOYEE);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedOffboardEmployee.mockResolvedValue({
      ...EMPLOYEE,
      employment_status: "RESIGNED",
      separation_date: "2026-06-01",
      separation_reason: "Took a new role elsewhere",
    });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Offboard" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Offboard" }));
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByText("Resigned"));
    await userEvent.type(screen.getByLabelText("Separation date"), "2026-06-01");
    await userEvent.type(screen.getByLabelText("Reason"), "Took a new role elsewhere");
    await userEvent.click(screen.getByRole("button", { name: "Confirm offboard" }));

    await waitFor(() =>
      expect(mockedOffboardEmployee).toHaveBeenCalledWith("emp-1", {
        separation_type: "RESIGNED",
        separation_date: "2026-06-01",
        reason: "Took a new role elsewhere",
      }),
    );
  });
});
