import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import * as departmentsApi from "@/api/departments";
import * as employeesApi from "@/api/employees";
import type { CampusRead, DepartmentRead, EmployeeRead } from "@/api/types";
import { EmployeeDetailPage } from "@/pages/EmployeeDetailPage";

vi.mock("@/api/employees");
vi.mock("@/api/departments");
vi.mock("@/api/campuses");

const mockedGetEmployee = vi.mocked(employeesApi.getEmployee);
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
  phone_number: "+91 9876543210",
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
});
