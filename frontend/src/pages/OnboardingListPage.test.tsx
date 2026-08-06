import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as applicationsApi from "@/api/applications";
import * as campusesApi from "@/api/campuses";
import * as candidatesApi from "@/api/candidates";
import type { ApplicationRead, ApplicationStatus, CandidateRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import * as jobPostingLookup from "@/hooks/useJobPostingLookup";
import { OnboardingListPage } from "@/pages/OnboardingListPage";

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

function makeCandidate(overrides: Partial<CandidateRead>): CandidateRead {
  return {
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
    ...overrides,
  };
}

function makeApplication(overrides: Partial<ApplicationRead>): ApplicationRead {
  return {
    id: "app-1",
    candidate_id: "cand-1",
    job_posting_id: "jp-1",
    campus_id: "c-sse",
    status: "JOINED",
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
    updated_at: "2026-01-05T00:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OnboardingListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockByStatus(byStatus: Partial<Record<ApplicationStatus, ApplicationRead[]>>) {
  mockedListApplications.mockImplementation(async ({ status } = {}) => {
    if (!status) return [];
    return byStatus[status] ?? [];
  });
}

const CANDIDATE_JANE = makeCandidate({});

describe("OnboardingListPage", () => {
  it("blocks the page for a role without view access", () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });
    mockedListCandidates.mockResolvedValue([]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage();

    expect(screen.getByText(/Only a Recruitment Officer, HR Admin, or Super Admin/)).toBeInTheDocument();
  });

  it("renders applications across all 4 onboarding stages joined with candidate and position", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockByStatus({
      JOINING_CONFIRMED: [makeApplication({ id: "app-1", status: "JOINING_CONFIRMED" })],
      JOINED: [makeApplication({ id: "app-2", candidate_id: "cand-2", status: "JOINED" })],
    });
    mockedListCandidates.mockResolvedValue([CANDIDATE_JANE, makeCandidate({ id: "cand-2", full_name: "John Smith" })]);
    mockedListCampuses.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({
      getLabel: () => ({ positionTitle: "Assistant Professor", campusId: "c-sse", slug: "slug-1" }),
      jobPostings: [],
      isLoading: false,
    });

    renderPage();

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    expect(screen.getAllByText("Assistant Professor")).toHaveLength(2);
  });

  it("narrows the list client-side by stage without re-fetching", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockByStatus({
      JOINING_CONFIRMED: [makeApplication({ id: "app-1", status: "JOINING_CONFIRMED" })],
      JOINED: [makeApplication({ id: "app-2", candidate_id: "cand-2", status: "JOINED" })],
    });
    mockedListCandidates.mockResolvedValue([CANDIDATE_JANE, makeCandidate({ id: "cand-2", full_name: "John Smith" })]);
    mockedListCampuses.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({
      getLabel: () => ({ positionTitle: "Assistant Professor", campusId: "c-sse", slug: "slug-1" }),
      jobPostings: [],
      isLoading: false,
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    const callCountBeforeFilter = mockedListApplications.mock.calls.length;

    await userEvent.click(screen.getByRole("combobox", { name: "Stage filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "JOINED" }));

    expect(screen.queryByText("Jane Doe")).not.toBeInTheDocument();
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    expect(mockedListApplications).toHaveBeenCalledTimes(callCountBeforeFilter);
  });

  it("narrows the list client-side by campus", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockByStatus({
      JOINING_CONFIRMED: [makeApplication({ id: "app-1", status: "JOINING_CONFIRMED", campus_id: "c-sse" })],
      JOINED: [
        makeApplication({ id: "app-2", candidate_id: "cand-2", status: "JOINED", campus_id: "c-scad" }),
      ],
    });
    mockedListCandidates.mockResolvedValue([CANDIDATE_JANE, makeCandidate({ id: "cand-2", full_name: "John Smith" })]);
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

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SCAD" }));

    expect(screen.queryByText("Jane Doe")).not.toBeInTheDocument();
    expect(screen.getByText("John Smith")).toBeInTheDocument();
  });

  it("narrows the list client-side by a candidate-or-position search", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockByStatus({
      JOINING_CONFIRMED: [makeApplication({ id: "app-1", status: "JOINING_CONFIRMED" })],
      JOINED: [makeApplication({ id: "app-2", candidate_id: "cand-2", status: "JOINED" })],
    });
    mockedListCandidates.mockResolvedValue([CANDIDATE_JANE, makeCandidate({ id: "cand-2", full_name: "John Smith" })]);
    mockedListCampuses.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({
      getLabel: () => ({ positionTitle: "Assistant Professor", campusId: "c-sse", slug: "slug-1" }),
      jobPostings: [],
      isLoading: false,
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("John Smith")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Search by candidate or position"), "john");

    expect(screen.queryByText("Jane Doe")).not.toBeInTheDocument();
    expect(screen.getByText("John Smith")).toBeInTheDocument();
  });

  it("shows a filters-specific empty state and a last-updated date column", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockByStatus({
      JOINING_CONFIRMED: [makeApplication({ id: "app-1", status: "JOINING_CONFIRMED", updated_at: "2026-02-10T00:00:00Z" })],
    });
    mockedListCandidates.mockResolvedValue([CANDIDATE_JANE]);
    mockedListCampuses.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({
      getLabel: () => ({ positionTitle: "Assistant Professor", campusId: "c-sse", slug: "slug-1" }),
      jobPostings: [],
      isLoading: false,
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText(new Date("2026-02-10T00:00:00Z").toLocaleDateString())).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Search by candidate or position"), "nonexistent");

    expect(
      await screen.findByText("No one in the onboarding pipeline matches these filters."),
    ).toBeInTheDocument();
  });
});
