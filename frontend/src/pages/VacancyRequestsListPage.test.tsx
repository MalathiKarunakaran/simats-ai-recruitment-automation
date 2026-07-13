import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import type { UserRead, VacancyRequestRead } from "@/api/types";
import * as vacancyRequestsApi from "@/api/vacancyRequests";
import * as authContext from "@/auth/AuthContext";
import { VacancyRequestsListPage } from "@/pages/VacancyRequestsListPage";

vi.mock("@/api/vacancyRequests");
vi.mock("@/api/campuses");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListVacancyRequests = vi.mocked(vacancyRequestsApi.listVacancyRequests);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);

const VR: VacancyRequestRead = {
  id: "vr-1",
  campus_id: "c-sse",
  department_id: "d-1",
  role_category: "TEACHING",
  position_title: "Assistant Professor",
  employment_type: "FULL_TIME",
  requested_count: 2,
  qualification: "PhD",
  experience_required: "3+ years",
  salary_band_min: null,
  salary_band_max: null,
  jd_draft: null,
  skills: null,
  priority: "NORMAL",
  status: "DRAFT",
  requested_by_id: "u-1",
  submitted_at: null,
  dean_reviewed_by_id: null,
  dean_reviewed_at: null,
  hr_reviewed_by_id: null,
  hr_reviewed_at: null,
  rejected_by_id: null,
  rejected_at: null,
  rejection_reason: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <VacancyRequestsListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("VacancyRequestsListPage", () => {
  it("renders rows from the API response", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedListVacancyRequests.mockResolvedValue([VR]);
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.getByText("SSE")).toBeInTheDocument();
  });

  it("shows the create button for a CAMPUS_HOD but not for an unrelated role", async () => {
    mockedListVacancyRequests.mockResolvedValue([]);
    mockedListCampuses.mockResolvedValue([]);

    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    const { unmount } = renderPage();
    await waitFor(() => expect(screen.getByText("New vacancy request")).toBeInTheDocument());
    unmount();

    mockedUseAuth.mockReturnValue({
      user: { role: "INTERVIEW_PANEL_MEMBER" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/No vacancy requests/)).toBeInTheDocument());
    expect(screen.queryByText("New vacancy request")).not.toBeInTheDocument();
  });

  it("re-fetches with the selected status when the filter changes", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedListVacancyRequests.mockResolvedValue([VR]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage();
    await waitFor(() => expect(mockedListVacancyRequests).toHaveBeenCalledWith(null));

    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: "SUBMITTED" }));

    await waitFor(() => expect(mockedListVacancyRequests).toHaveBeenCalledWith("SUBMITTED"));
  });
});
