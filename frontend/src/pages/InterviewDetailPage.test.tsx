import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as applicationsApi from "@/api/applications";
import * as candidatesApi from "@/api/candidates";
import * as interviewsApi from "@/api/interviews";
import type {
  ApplicationRead,
  CandidateRead,
  InterviewFeedbackRead,
  InterviewScheduleRead,
  UserRead,
} from "@/api/types";
import * as usersApi from "@/api/users";
import * as authContext from "@/auth/AuthContext";
import * as jobPostingLookup from "@/hooks/useJobPostingLookup";
import { InterviewDetailPage } from "@/pages/InterviewDetailPage";

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
const mockedGetInterview = vi.mocked(interviewsApi.getInterview);
const mockedGetApplication = vi.mocked(applicationsApi.getApplication);
const mockedGetCandidate = vi.mocked(candidatesApi.getCandidate);
const mockedListUsers = vi.mocked(usersApi.listUsers);
const mockedListInterviewFeedback = vi.mocked(interviewsApi.listInterviewFeedback);
const mockedUseJobPostingLookup = vi.mocked(jobPostingLookup.useJobPostingLookup);
const mockedGenerateInterviewQuestions = vi.mocked(interviewsApi.generateInterviewQuestions);
const mockedUpdateInterview = vi.mocked(interviewsApi.updateInterview);

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

const PANEL_MEMBER: UserRead = {
  id: "panel-1",
  email: "panel@example.com",
  full_name: "Panel Member",
  role: "INTERVIEW_PANEL_MEMBER",
  campus_id: "c-sse",
  department_id: null,
  is_active: true,
  is_email_verified: true,
  must_change_password: false,
  deactivation_protected: false,
  phone_number: null,
  last_login_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function makeInterview(overrides: Partial<InterviewScheduleRead> = {}): InterviewScheduleRead {
  return {
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
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/interviews/int-1"]}>
        <Routes>
          <Route path="/interviews/:id" element={<InterviewDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGetApplication.mockResolvedValue(APPLICATION);
  mockedGetCandidate.mockResolvedValue(CANDIDATE);
  mockedListUsers.mockResolvedValue([PANEL_MEMBER]);
  mockedListInterviewFeedback.mockResolvedValue([]);
  mockedUseJobPostingLookup.mockReturnValue({
    getLabel: () => ({ positionTitle: "Assistant Professor", campusId: "c-sse", slug: "slug-1" }),
    jobPostings: [],
    isLoading: false,
  });
});

describe("InterviewDetailPage", () => {
  it("shows mark-completed and cancel for HR Admin on a SCHEDULED interview", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetInterview.mockResolvedValue(makeInterview());

    renderPage();

    await waitFor(() => expect(screen.getByText("Panel Member")).toBeInTheDocument());
    expect(screen.getByText("Mark completed")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("hides mark-completed once the interview is COMPLETED", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetInterview.mockResolvedValue(makeInterview({ status: "COMPLETED" }));

    renderPage();

    await waitFor(() => expect(screen.getByText("Panel Member")).toBeInTheDocument());
    expect(screen.queryByText("Mark completed")).not.toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("shows the feedback form only to the assigned panel member without existing feedback", async () => {
    mockedUseAuth.mockReturnValue({
      user: { id: "panel-1", role: "INTERVIEW_PANEL_MEMBER" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetInterview.mockResolvedValue(makeInterview());

    renderPage();

    await waitFor(() => expect(screen.getByText("Submit feedback")).toBeInTheDocument());
  });

  it("hides the feedback form once the panel member already submitted", async () => {
    mockedUseAuth.mockReturnValue({
      user: { id: "panel-1", role: "INTERVIEW_PANEL_MEMBER" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetInterview.mockResolvedValue(makeInterview());
    mockedListInterviewFeedback.mockResolvedValue([
      {
        id: "fb-1",
        interview_schedule_id: "int-1",
        panel_member_id: "panel-1",
        technical_score: 8,
        communication_score: 7,
        research_score: null,
        teaching_demo_score: null,
        overall_recommendation: "HIRE",
        comments: null,
        submitted_at: "2026-02-01T11:00:00Z",
      } satisfies InterviewFeedbackRead,
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText(/Recommendation: HIRE/)).toBeInTheDocument());
    expect(screen.queryByText("Submit feedback")).not.toBeInTheDocument();
  });

  it("hides all write actions and the feedback form for an unassigned panel member", async () => {
    mockedUseAuth.mockReturnValue({
      user: { id: "other-panel", role: "INTERVIEW_PANEL_MEMBER" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetInterview.mockResolvedValue(makeInterview());

    renderPage();

    await waitFor(() => expect(screen.getByText("Panel Member")).toBeInTheDocument());
    expect(screen.queryByText("Submit feedback")).not.toBeInTheDocument();
    expect(screen.queryByText("Mark completed")).not.toBeInTheDocument();
    expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
    expect(screen.queryByText("Generate interview questions")).not.toBeInTheDocument();
  });

  // RBAC permission-gate audit (2026-08-24): submit_interview_feedback is
  // gated by require_permission(MARK_INTERVIEW_COMPLETED), not
  // "role === INTERVIEW_PANEL_MEMBER" alone -- for a caller who's actually
  // assigned to this interview's panel_member_ids (a separate, still-
  // enforced backend rule this fix doesn't touch), an individually-granted
  // MARK_INTERVIEW_COMPLETED must still unlock the feedback form even for a
  // non-INTERVIEW_PANEL_MEMBER role.
  it("shows the feedback form to an assigned panel member of another role individually granted MARK_INTERVIEW_COMPLETED", async () => {
    mockedUseAuth.mockReturnValue({
      user: { id: "panel-1", role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
      hasPermission: (permission) => permission === "MARK_INTERVIEW_COMPLETED",
    });
    mockedGetInterview.mockResolvedValue(makeInterview());

    renderPage();

    await waitFor(() => expect(screen.getByText("Submit feedback")).toBeInTheDocument());
  });

  // RBAC permission-gate audit follow-up (2026-08-24): update_interview
  // (PATCH /interviews/{id}) is gated by two distinct permissions depending
  // on the payload -- RESCHEDULE_INTERVIEW for everything except cancelling,
  // CANCEL_INTERVIEW for cancelling -- via an inline has_permission() call
  // that fell outside the main Step 7 audit's require_permission(...)
  // dependency grep scope. A CAMPUS_HOD (outside WRITE_ROLES) individually
  // granted only RESCHEDULE_INTERVIEW must see Edit/Mark completed but NOT
  // Cancel.
  it("shows Edit and Mark completed (not Cancel) for a non-write role individually granted RESCHEDULE_INTERVIEW", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
      hasPermission: (permission) => permission === "RESCHEDULE_INTERVIEW",
    });
    mockedGetInterview.mockResolvedValue(makeInterview());

    renderPage();

    await waitFor(() => expect(screen.getByText("Edit")).toBeInTheDocument());
    expect(screen.getByText("Mark completed")).toBeInTheDocument();
    expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
  });

  // Same audit, the mirror case: a non-write role individually granted only
  // CANCEL_INTERVIEW must see Cancel but NOT Edit/Mark completed.
  it("shows Cancel (not Edit or Mark completed) for a non-write role individually granted CANCEL_INTERVIEW", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
      hasPermission: (permission) => permission === "CANCEL_INTERVIEW",
    });
    mockedGetInterview.mockResolvedValue(makeInterview());

    renderPage();

    await waitFor(() => expect(screen.getByText("Cancel")).toBeInTheDocument());
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
    expect(screen.queryByText("Mark completed")).not.toBeInTheDocument();
  });

  it("shows Generate interview questions for an assigned panel member without write access, and renders results", async () => {
    mockedUseAuth.mockReturnValue({
      user: { id: "panel-1", role: "INTERVIEW_PANEL_MEMBER" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetInterview.mockResolvedValue(makeInterview());
    mockedGenerateInterviewQuestions.mockResolvedValue({
      questions: [
        { category: "Technical", question: "Describe a project you led." },
        { category: "Behavioral", question: "How do you handle disagreement?" },
      ],
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("Generate interview questions")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Generate interview questions"));

    await waitFor(() => expect(mockedGenerateInterviewQuestions).toHaveBeenCalledWith("int-1"));
    expect(await screen.findByText("Describe a project you led.")).toBeInTheDocument();
    expect(screen.getByText("How do you handle disagreement?")).toBeInTheDocument();
  });

  it("cancelling an interview requires confirming a dialog before the mutation fires", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetInterview.mockResolvedValue(makeInterview());
    mockedUpdateInterview.mockResolvedValue(makeInterview({ status: "CANCELLED" }));

    renderPage();
    await waitFor(() => expect(screen.getByText("Cancel")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockedUpdateInterview).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    expect(screen.getByText("Cancel this interview? This cannot be undone.")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm cancel" }));

    await waitFor(() => expect(mockedUpdateInterview).toHaveBeenCalledWith("int-1", { status: "CANCELLED" }));
  });

  it("Close on the cancel confirm dialog aborts without calling the mutation", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetInterview.mockResolvedValue(makeInterview());
    mockedUpdateInterview.mockResolvedValue(makeInterview({ status: "CANCELLED" }));
    mockedUpdateInterview.mockClear(); // a prior test in this file already confirmed a cancel

    renderPage();
    await waitFor(() => expect(screen.getByText("Cancel")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const dialog = await screen.findByRole("dialog");

    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockedUpdateInterview).not.toHaveBeenCalled();
  });
});
