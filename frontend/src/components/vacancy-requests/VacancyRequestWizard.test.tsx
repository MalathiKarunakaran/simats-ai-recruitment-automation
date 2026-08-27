import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import { ApiError } from "@/api/client";
import * as departmentsApi from "@/api/departments";
import * as designationsApi from "@/api/designations";
import * as sanctionedStrengthApi from "@/api/sanctionedStrength";
import type { UserRead } from "@/api/types";
import * as vacancyRequestsApi from "@/api/vacancyRequests";
import * as authContext from "@/auth/AuthContext";
import { VacancyRequestWizard } from "@/components/vacancy-requests/VacancyRequestWizard";

vi.mock("@/api/campuses");
vi.mock("@/api/departments");
vi.mock("@/api/designations");
vi.mock("@/api/sanctionedStrength");
vi.mock("@/api/vacancyRequests");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedListDepartments = vi.mocked(departmentsApi.listDepartments);
const mockedListDesignations = vi.mocked(designationsApi.listDesignations);
const mockedGetAvailability = vi.mocked(sanctionedStrengthApi.getSanctionedStrengthAvailability);
const mockedCreateVacancyRequest = vi.mocked(vacancyRequestsApi.createVacancyRequest);

const CAMPUSES = [{ id: "c-sse", code: "SSE" as const, name: "SSE Campus", is_active: true, created_at: "", updated_at: "" }];

const DEPARTMENTS = [
  {
    id: "d-1",
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
];

const DESIGNATIONS = [
  {
    id: "desg-1",
    name: "Assistant Professor",
    category: "TEACHING" as const,
    qualification: "PhD",
    min_experience: "2+ years",
    employment_type: "FULL_TIME" as const,
    required_skills: null,
    is_active: true,
    department_ids: ["d-1"],
    created_at: "",
    updated_at: "",
  },
];

function renderWizard(initialPath = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <VacancyRequestWizard onSuccess={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("VacancyRequestWizard", () => {
  it("walks a CAMPUS_HOD (locked to their own department) through all 7 steps and submits using the selected designation's own fields", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD", campus_id: "c-sse", department_id: "d-1" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue(CAMPUSES);
    mockedListDepartments.mockResolvedValue(DEPARTMENTS);
    mockedListDesignations.mockResolvedValue(DESIGNATIONS);
    mockedGetAvailability.mockResolvedValue({
      approved: 5,
      working: 3,
      vacant: 2,
      already_requested: 1,
      available_to_request: 1,
    });
    mockedCreateVacancyRequest.mockResolvedValue({ id: "vr-new" } as never);

    renderWizard();

    // Step 1: role category.
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /^Teaching/ }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 2: department locked to the HOD's own department -- no select shown.
    expect(screen.getByText("Computer Science")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 3: designation, fetched via the department+category linkage.
    expect(await screen.findByRole("button", { name: /^Assistant Professor/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Assistant Professor/ }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 4: required count -- the availability strip shows now that a
    // designation is picked (Phase E item 24).
    expect(await screen.findByText(/Available to request/)).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument(); // approved
    const countInput = screen.getByLabelText("Required count");
    await userEvent.clear(countInput);
    await userEvent.type(countInput, "3");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 5: employment type, pre-filled from the designation.
    expect(screen.getByText(/Pre-filled from Assistant Professor/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 6: priority (default NORMAL).
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 7: remarks + submit.
    await userEvent.type(screen.getByLabelText("Remarks (optional)"), "Please expedite");
    await userEvent.click(screen.getByRole("button", { name: "Submit vacancy request" }));

    await waitFor(() =>
      expect(mockedCreateVacancyRequest).toHaveBeenCalledWith({
        campus_id: "c-sse",
        department_id: "d-1",
        designation_id: "desg-1",
        role_category: "TEACHING",
        position_title: "Assistant Professor",
        employment_type: "FULL_TIME",
        requested_count: 3,
        qualification: "PhD",
        experience_required: "2+ years",
        priority: "NORMAL",
        remarks: "Please expedite",
      }),
    );
  }, 15000);

  it("falls back to manual position-title/qualification/experience entry when no Designation Master entry matches", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN", campus_id: null, department_id: null } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue(CAMPUSES);
    mockedListDepartments.mockResolvedValue(DEPARTMENTS);
    mockedListDesignations.mockResolvedValue([]);
    mockedCreateVacancyRequest.mockResolvedValue({ id: "vr-new" } as never);

    renderWizard();

    await userEvent.click(screen.getByRole("button", { name: /^Teaching/ }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    // Super Admin picks a campus, then a department.
    await userEvent.click(screen.getAllByRole("combobox")[0]);
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));
    await userEvent.click(screen.getAllByRole("combobox")[1]);
    await userEvent.click(await screen.findByRole("option", { name: "Computer Science" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText(/No designations in the Designation Master/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Position title"), "Guest Lecturer");
    await userEvent.type(screen.getByLabelText("Qualification"), "MSc");
    await userEvent.type(screen.getByLabelText("Experience required"), "1+ years");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    await userEvent.click(screen.getByRole("button", { name: "Next" })); // required count default "1"
    await userEvent.click(screen.getByRole("button", { name: "Next" })); // employment type default
    await userEvent.click(screen.getByRole("button", { name: "Next" })); // priority default
    await userEvent.click(screen.getByRole("button", { name: "Submit vacancy request" }));

    await waitFor(() =>
      expect(mockedCreateVacancyRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          designation_id: null,
          position_title: "Guest Lecturer",
          qualification: "MSc",
          experience_required: "1+ years",
        }),
      ),
    );
  }, 15000);

  it("surfaces an API error on submit instead of silently failing", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD", campus_id: "c-sse", department_id: "d-1" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue(CAMPUSES);
    mockedListDepartments.mockResolvedValue(DEPARTMENTS);
    mockedListDesignations.mockResolvedValue(DESIGNATIONS);
    mockedGetAvailability.mockResolvedValue({
      approved: 5,
      working: 3,
      vacant: 2,
      already_requested: 1,
      available_to_request: 1,
    });
    mockedCreateVacancyRequest.mockRejectedValue(new ApiError(400, "requested_count must be positive"));

    renderWizard();

    await userEvent.click(screen.getByRole("button", { name: /^Teaching/ }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Assistant Professor/ }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Submit vacancy request" }));

    expect(await screen.findByText("requested_count must be positive")).toBeInTheDocument();
  }, 15000);

  it("prefills campus/department/designation from ?campus=&department=&designation= and caps requested count at ?maxCount= (Phase E item 30 deep link)", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN", campus_id: null, department_id: null } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue(CAMPUSES);
    mockedListDepartments.mockResolvedValue([{ ...DEPARTMENTS[0], category: "TEACHING" as const }]);
    mockedListDesignations.mockResolvedValue(DESIGNATIONS);
    mockedGetAvailability.mockResolvedValue({
      approved: 5,
      working: 3,
      vacant: 2,
      already_requested: 0,
      available_to_request: 2,
    });

    renderWizard("/?campus=c-sse&department=d-1&designation=desg-1&maxCount=2");

    // The deep link jumps straight to the "Required count" step (Step 4)
    // with all three pickers already resolved.
    const countInput = await screen.findByLabelText("Required count");
    expect(screen.getByText(/Capped at 2 available posts/)).toBeInTheDocument();
    expect(await screen.findByText(/Available to request/)).toBeInTheDocument();

    await userEvent.clear(countInput);
    await userEvent.type(countInput, "9");
    expect(countInput).toHaveValue(2); // clamped down to maxCount client-side
  }, 15000);
});
