import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import * as departmentsApi from "@/api/departments";
import type { UserRead } from "@/api/types";
import * as vacancyRequestsApi from "@/api/vacancyRequests";
import * as authContext from "@/auth/AuthContext";
import { VacancyRequestForm } from "@/components/vacancy-requests/VacancyRequestForm";

vi.mock("@/api/campuses");
vi.mock("@/api/departments");
vi.mock("@/api/vacancyRequests");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedListDepartments = vi.mocked(departmentsApi.listDepartments);
const mockedCreateVacancyRequest = vi.mocked(vacancyRequestsApi.createVacancyRequest);

const CAMPUSES = [
  { id: "c-sse", code: "SSE" as const, name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
  { id: "c-scad", code: "SCAD" as const, name: "SCAD Campus", is_active: true, created_at: "", updated_at: "" },
];

const DEPARTMENTS = [
  {
    id: "d-sse-1",
    campus_id: "c-sse",
    name: "Computer Science",
    code: null,
    category: null,
    parent_group: null,
    description: null,
    is_active: true,
    created_at: "",
    updated_at: "",
  },
  {
    id: "d-scad-1",
    campus_id: "c-scad",
    name: "Architecture",
    code: null,
    category: null,
    parent_group: null,
    description: null,
    is_active: true,
    created_at: "",
    updated_at: "",
  },
];

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <VacancyRequestForm mode="create" onSuccess={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("VacancyRequestForm (create mode)", () => {
  it("only offers departments belonging to the selected campus", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN", campus_id: null } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue(CAMPUSES);
    mockedListDepartments.mockResolvedValue(DEPARTMENTS);

    renderForm();

    const [campusTrigger] = await screen.findAllByRole("combobox");
    await userEvent.click(campusTrigger);
    await userEvent.click(await screen.findByRole("option", { name: /SSE/ }));

    const [, departmentTrigger] = await screen.findAllByRole("combobox");
    await userEvent.click(departmentTrigger);
    expect(await screen.findByRole("option", { name: "Computer Science" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Architecture" })).not.toBeInTheDocument();
  });

  it("submits with the expected payload, splitting comma-separated skills into an array", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD", campus_id: "c-sse" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    // Several sequential userEvent.type() calls -- slower than the default
    // 5s test timeout in this environment.
    mockedListCampuses.mockResolvedValue(CAMPUSES);
    mockedListDepartments.mockResolvedValue(DEPARTMENTS);
    mockedCreateVacancyRequest.mockResolvedValue({ id: "vr-new" } as never);

    renderForm();

    // Campus is a locked label (not a combobox) for a CAMPUS_HOD, so
    // Department is the first combobox on the page in this scenario.
    const [departmentTrigger] = await screen.findAllByRole("combobox");
    await userEvent.click(departmentTrigger);
    await userEvent.click(await screen.findByRole("option", { name: "Computer Science" }));

    await userEvent.type(screen.getByLabelText("Position title"), "Assistant Professor");
    await userEvent.type(screen.getByLabelText("Qualification"), "PhD in CS");
    await userEvent.type(screen.getByLabelText("Experience required"), "3+ years");
    await userEvent.type(screen.getByLabelText(/Skills/), "Python, Teaching");

    await userEvent.click(screen.getByText("Create vacancy request"));

    await waitFor(() =>
      expect(mockedCreateVacancyRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          campus_id: "c-sse",
          department_id: "d-sse-1",
          position_title: "Assistant Professor",
          qualification: "PhD in CS",
          experience_required: "3+ years",
          skills: ["Python", "Teaching"],
        }),
      ),
    );
  }, 15000);
});
