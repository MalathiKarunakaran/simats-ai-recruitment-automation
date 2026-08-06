import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as applicationsApi from "@/api/applications";
import * as candidatesApi from "@/api/candidates";
import * as interviewsApi from "@/api/interviews";
import type { ApplicationRead, CandidateRead, InterviewScheduleRead, UserRead } from "@/api/types";
import * as usersApi from "@/api/users";
import * as authContext from "@/auth/AuthContext";
import * as jobPostingLookup from "@/hooks/useJobPostingLookup";
import { InterviewCreatePage } from "@/pages/InterviewCreatePage";

vi.mock("@/api/interviews");
vi.mock("@/api/applications");
vi.mock("@/api/candidates");
vi.mock("@/api/users");
vi.mock("@/hooks/useJobPostingLookup");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListApplications = vi.mocked(applicationsApi.listApplications);
const mockedListCandidates = vi.mocked(candidatesApi.listCandidates);
const mockedListUsers = vi.mocked(usersApi.listUsers);
const mockedCreateInterview = vi.mocked(interviewsApi.createInterview);
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
  status: "CALLED_FOR_INTERVIEW",
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

const PANEL_MEMBER: UserRead = {
  id: "panel-1",
  email: "panel@example.com",
  full_name: "Panel Member",
  role: "INTERVIEW_PANEL_MEMBER",
  campus_id: "c-sse",
  department_id: null,
  is_active: true,
  is_email_verified: true,
  phone_number: null,
  last_login_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderPage(initialPath = "/interviews/new") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/interviews/new" element={<InterviewCreatePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("InterviewCreatePage", () => {
  it("blocks access for a role without write access", () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedListApplications.mockResolvedValue([]);
    mockedListCandidates.mockResolvedValue([]);
    mockedListUsers.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });

    renderPage();
    expect(screen.getByText(/Only a Recruitment Officer/)).toBeInTheDocument();
  });

  it("pre-fills the application from the query param and requires at least one panel member", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedListApplications.mockResolvedValue([APPLICATION]);
    mockedListCandidates.mockResolvedValue([CANDIDATE]);
    mockedListUsers.mockResolvedValue([PANEL_MEMBER]);
    mockedUseJobPostingLookup.mockReturnValue({
      getLabel: () => ({ positionTitle: "Assistant Professor", campusId: "c-sse", slug: "slug-1" }),
      jobPostings: [],
      isLoading: false,
    });
    mockedCreateInterview.mockResolvedValue({ id: "int-1" } as InterviewScheduleRead);

    renderPage("/interviews/new?application_id=app-1");

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText(/Assistant Professor/)).toBeInTheDocument();

    const submitButton = screen.getByRole("button", { name: "Schedule interview" });
    expect(submitButton).toBeDisabled();

    await userEvent.click(await screen.findByText("Panel Member"));
    await userEvent.type(screen.getByLabelText("Scheduled at"), "2026-03-01T10:00");

    expect(submitButton).not.toBeDisabled();
    await userEvent.click(submitButton);

    await waitFor(() =>
      expect(mockedCreateInterview).toHaveBeenCalledWith(
        expect.objectContaining({ application_id: "app-1", panel_member_ids: ["panel-1"] }),
      ),
    );
  });
});
