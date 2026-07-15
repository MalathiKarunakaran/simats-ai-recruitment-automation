import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import * as departmentsApi from "@/api/departments";
import * as employeesApi from "@/api/employees";
import type { CampusRead, DepartmentRead, EmployeeRead } from "@/api/types";
import { EmployeesListPage } from "@/pages/EmployeesListPage";

vi.mock("@/api/employees");
vi.mock("@/api/departments");
vi.mock("@/api/campuses");

const mockedListEmployees = vi.mocked(employeesApi.listEmployees);
const mockedListDepartments = vi.mocked(departmentsApi.listDepartments);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);

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
  phone_number: null,
  designation: "Assistant Professor",
  date_of_joining: "2026-03-01",
  user_id: null,
  created_at: "2026-01-02T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <EmployeesListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("EmployeesListPage", () => {
  it("renders employees with resolved department and campus names", async () => {
    mockedListEmployees.mockResolvedValue([EMPLOYEE]);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("SSE-0001")).toBeInTheDocument();
    expect(screen.getByText("Computer Science")).toBeInTheDocument();
    expect(screen.getByText("SSE")).toBeInTheDocument();
  });

  it("shows the empty-state message when no employees exist", async () => {
    mockedListEmployees.mockResolvedValue([]);
    mockedListDepartments.mockResolvedValue([]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText("No employees found.")).toBeInTheDocument());
  });

  it("narrows the list with the search box", async () => {
    mockedListEmployees.mockResolvedValue([
      EMPLOYEE,
      { ...EMPLOYEE, id: "emp-2", employee_code: "SSE-0002", full_name: "John Smith", email: "john@example.com" },
    ]);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("John Smith")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText(/Search by name/), "jane");

    await waitFor(() => expect(screen.queryByText("John Smith")).not.toBeInTheDocument());
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
  });
});
