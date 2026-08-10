import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as applicationsApi from "@/api/applications";
import * as campusesApi from "@/api/campuses";
import * as candidatesApi from "@/api/candidates";
import type { ApplicationRead, CandidateRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import * as jobPostingLookup from "@/hooks/useJobPostingLookup";
import { ApplicationsListPage } from "@/pages/ApplicationsListPage";

vi.mock("@/api/applications");
vi.mock("@/api/candidates");
vi.mock("@/api/campuses");
vi.mock("@/hooks/useJobPostingLookup");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListApplications = vi.mocked(applicationsApi.listApplications);
const mockedListCandidates = vi.mocked(candidatesApi.listCandidates);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedUseJobPostingLookup = vi.mocked(jobPostingLookup.useJobPostingLookup);

const CANDIDATE: CandidateRead = {
  id: "cand-1",
  full_name: "Jane Doe",
  email: "jane@example.com",
  phone_number: null,
  resume_storage_key: null,
  source: null,
  reference_name: null,
  is_withdrawn: false,
  withdrawn_at: null,
  withdrawn_reason: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const APPLICATION: ApplicationRead = {
  id: "app-1",
  candidate_id: "cand-1",
  job_posting_id: "jp-1",
  campus_id: "c-sse",
  role_category: "TEACHING",
  status: "APPLIED",
  applied_at: "2026-01-02T00:00:00Z",
  recorded_by_id: "u-1",
  rejection_reason: null,
  rejected_at: null,
  withdrawn_reason: null,
  withdrawn_at: null,
  panel_members: null,
  panel_result: null,
  panel_remarks: null,
  salary_fixed: null,
  called_date: null,
  interview_scheduled_date: null,
  offer_given_date: null,
  expected_joining_date: null,
  actual_joining_date: null,
  department_allotted_id: null,
  room_allotted: null,
  orientation_date: null,
  hod_assigned: null,
  qualification_mismatch: false,
  qualification_mismatch_reason: null,
  created_at: "2026-01-02T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ApplicationsListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ApplicationsListPage", () => {
  it("renders applications joined with candidate and position labels", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedListApplications.mockResolvedValue([APPLICATION]);
    mockedListCandidates.mockResolvedValue([CANDIDATE]);
    mockedListCampuses.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({
      getLabel: () => ({ positionTitle: "Assistant Professor", campusId: "c-sse", slug: "slug-1" }),
      jobPostings: [],
      isLoading: false,
    });

    renderPage();

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("Assistant Professor")).toBeInTheDocument();
  });

  it("re-fetches with the selected status when the filter changes", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedListApplications.mockResolvedValue([]);
    mockedListCandidates.mockResolvedValue([]);
    mockedListCampuses.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });

    renderPage();
    await waitFor(() => expect(mockedListApplications).toHaveBeenCalledWith({ status: null }));

    await userEvent.click(screen.getByRole("combobox", { name: "Status filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "CALLED FOR INTERVIEW" }));

    await waitFor(() => expect(mockedListApplications).toHaveBeenCalledWith({ status: "CALLED_FOR_INTERVIEW" }));
  });

  it("hides the create button for a role without write access", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedListApplications.mockResolvedValue([]);
    mockedListCandidates.mockResolvedValue([]);
    mockedListCampuses.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });

    renderPage();
    await waitFor(() => expect(screen.getByText(/No applications/)).toBeInTheDocument());
    expect(screen.queryByText("New application")).not.toBeInTheDocument();
  });

  it("narrows the list client-side by campus without re-fetching", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    const other: ApplicationRead = { ...APPLICATION, id: "app-2", candidate_id: "cand-2", campus_id: "c-scad" };
    mockedListApplications.mockResolvedValue([APPLICATION, other]);
    mockedListCandidates.mockResolvedValue([
      CANDIDATE,
      { ...CANDIDATE, id: "cand-2", full_name: "John Smith", email: "john@example.com" },
    ]);
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
      { id: "c-scad", code: "SCAD", name: "SCAD Campus", is_active: true, created_at: "", updated_at: "" },
    ]);
    mockedUseJobPostingLookup.mockReturnValue({
      getLabel: () => ({ positionTitle: "Assistant Professor", campusId: "c-sse", slug: "slug-1" }),
      jobPostings: [],
      isLoading: false,
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    const callCountBeforeFilter = mockedListApplications.mock.calls.length;

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SCAD" }));

    expect(screen.queryByText("Jane Doe")).not.toBeInTheDocument();
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    expect(mockedListApplications).toHaveBeenCalledTimes(callCountBeforeFilter);
  });

  it("narrows the list client-side by a candidate-or-position search", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    const other: ApplicationRead = { ...APPLICATION, id: "app-2", candidate_id: "cand-2", job_posting_id: "jp-2" };
    mockedListApplications.mockResolvedValue([APPLICATION, other]);
    mockedListCandidates.mockResolvedValue([
      CANDIDATE,
      { ...CANDIDATE, id: "cand-2", full_name: "John Smith", email: "john@example.com" },
    ]);
    mockedListCampuses.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({
      getLabel: (jobPostingId) =>
        jobPostingId === "jp-1"
          ? { positionTitle: "Assistant Professor", campusId: "c-sse", slug: "slug-1" }
          : { positionTitle: "Lab Assistant", campusId: "c-sse", slug: "slug-2" },
      jobPostings: [],
      isLoading: false,
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("John Smith")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Search by candidate or position"), "lab assistant");

    expect(screen.queryByText("Jane Doe")).not.toBeInTheDocument();
    expect(screen.getByText("John Smith")).toBeInTheDocument();
  });

  it("shows a filters-specific empty state when filters narrow a non-empty list to zero", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedListApplications.mockResolvedValue([APPLICATION]);
    mockedListCandidates.mockResolvedValue([CANDIDATE]);
    mockedListCampuses.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({
      getLabel: () => ({ positionTitle: "Assistant Professor", campusId: "c-sse", slug: "slug-1" }),
      jobPostings: [],
      isLoading: false,
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText("Search by candidate or position"), "nonexistent");

    expect(await screen.findByText("No applications match these filters.")).toBeInTheDocument();
  });
});
