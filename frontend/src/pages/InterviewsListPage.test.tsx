import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as applicationsApi from "@/api/applications";
import * as campusesApi from "@/api/campuses";
import * as candidatesApi from "@/api/candidates";
import * as interviewsApi from "@/api/interviews";
import type { ApplicationRead, CandidateRead, InterviewScheduleRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import * as jobPostingLookup from "@/hooks/useJobPostingLookup";
import { InterviewsListPage } from "@/pages/InterviewsListPage";

vi.mock("@/api/interviews");
vi.mock("@/api/applications");
vi.mock("@/api/candidates");
vi.mock("@/api/campuses");
vi.mock("@/hooks/useJobPostingLookup");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListInterviews = vi.mocked(interviewsApi.listInterviews);
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
  status: "INTERVIEWED",
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

const INTERVIEW: InterviewScheduleRead = {
  id: "int-1",
  application_id: "app-1",
  campus_id: "c-sse",
  interview_type: "TECHNICAL",
  scheduled_at: "2026-02-01T10:00:00Z",
  duration_minutes: 30,
  meeting_link: null,
  location: null,
  status: "SCHEDULED",
  scheduled_by_id: "u-1",
  notes: null,
  panel_member_ids: ["panel-1"],
  created_at: "2026-01-02T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <InterviewsListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("InterviewsListPage", () => {
  it("renders interviews joined with candidate and position labels", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedListInterviews.mockResolvedValue([INTERVIEW]);
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
    expect(screen.getByText("TECHNICAL")).toBeInTheDocument();
  });

  it("hides the schedule button for a role without write access", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedListInterviews.mockResolvedValue([]);
    mockedListApplications.mockResolvedValue([]);
    mockedListCandidates.mockResolvedValue([]);
    mockedListCampuses.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });

    renderPage();
    await waitFor(() => expect(screen.getByText(/No interviews/)).toBeInTheDocument());
    expect(screen.queryByText("Schedule interview")).not.toBeInTheDocument();
  });

  it("narrows the list client-side by campus without re-fetching", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN", id: "u-1" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    const other: InterviewScheduleRead = { ...INTERVIEW, id: "int-2", application_id: "app-2", campus_id: "c-scad" };
    mockedListInterviews.mockResolvedValue([INTERVIEW, other]);
    mockedListApplications.mockResolvedValue([
      APPLICATION,
      { ...APPLICATION, id: "app-2", candidate_id: "cand-2", campus_id: "c-scad" },
    ]);
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
    const callCountBeforeFilter = mockedListInterviews.mock.calls.length;

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SCAD" }));

    expect(screen.queryByText("Jane Doe")).not.toBeInTheDocument();
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    expect(mockedListInterviews).toHaveBeenCalledTimes(callCountBeforeFilter);
  });

  it("narrows the list client-side by a candidate-or-position search", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN", id: "u-1" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    const other: InterviewScheduleRead = { ...INTERVIEW, id: "int-2", application_id: "app-2" };
    mockedListInterviews.mockResolvedValue([INTERVIEW, other]);
    mockedListApplications.mockResolvedValue([APPLICATION, { ...APPLICATION, id: "app-2", candidate_id: "cand-2" }]);
    mockedListCandidates.mockResolvedValue([
      CANDIDATE,
      { ...CANDIDATE, id: "cand-2", full_name: "John Smith", email: "john@example.com" },
    ]);
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

  it("narrows the list client-side to interviews where the current user is an assigned panel member", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "INTERVIEW_PANEL_MEMBER", id: "panel-1" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    const notMine: InterviewScheduleRead = {
      ...INTERVIEW,
      id: "int-2",
      application_id: "app-2",
      panel_member_ids: ["panel-2"],
    };
    mockedListInterviews.mockResolvedValue([INTERVIEW, notMine]);
    mockedListApplications.mockResolvedValue([APPLICATION, { ...APPLICATION, id: "app-2", candidate_id: "cand-2" }]);
    mockedListCandidates.mockResolvedValue([
      CANDIDATE,
      { ...CANDIDATE, id: "cand-2", full_name: "John Smith", email: "john@example.com" },
    ]);
    mockedListCampuses.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({
      getLabel: () => ({ positionTitle: "Assistant Professor", campusId: "c-sse", slug: "slug-1" }),
      jobPostings: [],
      isLoading: false,
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("John Smith")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "My interviews only" }));

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.queryByText("John Smith")).not.toBeInTheDocument();
  });
});
