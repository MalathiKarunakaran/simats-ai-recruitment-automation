import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { UserRead, VacancyRequestRead } from "@/api/types";
import * as vacancyRequestsApi from "@/api/vacancyRequests";
import * as authContext from "@/auth/AuthContext";
import { VacancyRequestDetailPage } from "@/pages/VacancyRequestDetailPage";

vi.mock("@/api/vacancyRequests");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedGetVacancyRequest = vi.mocked(vacancyRequestsApi.getVacancyRequest);
const mockedSubmit = vi.mocked(vacancyRequestsApi.submitVacancyRequest);

function baseVr(overrides: Partial<VacancyRequestRead>): VacancyRequestRead {
  return {
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
    ...overrides,
  };
}

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/vacancy-requests/vr-1"]}>
        <Routes>
          <Route path="/vacancy-requests/:id" element={<VacancyRequestDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("VacancyRequestDetailPage", () => {
  it("shows Submit/Edit/Delete for a DRAFT request to its owning HOD", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD", campus_id: "c-sse" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetVacancyRequest.mockResolvedValue(baseVr({ status: "DRAFT" }));

    renderDetail();

    await waitFor(() => expect(screen.getByText("Submit")).toBeInTheDocument());
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.queryByText("Dean-approve")).not.toBeInTheDocument();
  });

  it("shows Dean-approve/Reject for a SUBMITTED request to a Dean, and neither to an unrelated role", async () => {
    mockedGetVacancyRequest.mockResolvedValue(baseVr({ status: "SUBMITTED" }));

    mockedUseAuth.mockReturnValue({
      user: { role: "ASSOCIATE_DEAN_RECRUITMENT" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    const { unmount } = renderDetail();
    await waitFor(() => expect(screen.getByText("Dean-approve")).toBeInTheDocument());
    expect(screen.getByText("Reject")).toBeInTheDocument();
    unmount();

    mockedUseAuth.mockReturnValue({
      user: { role: "RECRUITMENT_OFFICER" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    renderDetail();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.queryByText("Dean-approve")).not.toBeInTheDocument();
    expect(screen.queryByText("Reject")).not.toBeInTheDocument();
  });

  it("clicking Submit calls the mutation and the status updates", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD", campus_id: "c-sse" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetVacancyRequest.mockResolvedValueOnce(baseVr({ status: "DRAFT" }));
    mockedSubmit.mockResolvedValue(baseVr({ status: "SUBMITTED" }));
    mockedGetVacancyRequest.mockResolvedValueOnce(baseVr({ status: "SUBMITTED" }));

    renderDetail();
    await waitFor(() => expect(screen.getByText("Submit")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Submit"));

    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledWith("vr-1"));
    await waitFor(() => expect(screen.getByText("SUBMITTED")).toBeInTheDocument());
  });
});
