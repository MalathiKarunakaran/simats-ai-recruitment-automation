import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as applicationsApi from "@/api/applications";
import * as candidatesApi from "@/api/candidates";
import * as interviewsApi from "@/api/interviews";
import type { ApplicationRead, CandidateRead, InterviewScheduleRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import * as jobPostingLookup from "@/hooks/useJobPostingLookup";
import { InterviewsListPage } from "@/pages/InterviewsListPage";

vi.mock("@/api/interviews");
vi.mock("@/api/applications");
vi.mock("@/api/candidates");
vi.mock("@/hooks/useJobPostingLookup");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListInterviews = vi.mocked(interviewsApi.listInterviews);
const mockedListApplications = vi.mocked(applicationsApi.listApplications);
const mockedListCandidates = vi.mocked(candidatesApi.listCandidates);
const mockedUseJobPostingLookup = vi.mocked(jobPostingLookup.useJobPostingLookup);

const CANDIDATE: CandidateRead = {
  id: "cand-1",
  full_name: "Jane Doe",
  email: "jane@example.com",
  phone_number: null,
  resume_storage_key: null,
  source: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const APPLICATION: ApplicationRead = {
  id: "app-1",
  candidate_id: "cand-1",
  job_posting_id: "jp-1",
  campus_id: "c-sse",
  status: "TECHNICAL_INTERVIEW",
  applied_at: "2026-01-02T00:00:00Z",
  recorded_by_id: "u-1",
  rejection_reason: null,
  rejected_at: null,
  withdrawn_reason: null,
  withdrawn_at: null,
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
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedListInterviews.mockResolvedValue([INTERVIEW]);
    mockedListApplications.mockResolvedValue([APPLICATION]);
    mockedListCandidates.mockResolvedValue([CANDIDATE]);
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
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedListInterviews.mockResolvedValue([]);
    mockedListApplications.mockResolvedValue([]);
    mockedListCandidates.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });

    renderPage();
    await waitFor(() => expect(screen.getByText(/No interviews/)).toBeInTheDocument());
    expect(screen.queryByText("Schedule interview")).not.toBeInTheDocument();
  });
});
