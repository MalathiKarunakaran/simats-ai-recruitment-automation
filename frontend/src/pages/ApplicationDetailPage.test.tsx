import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as applicationsApi from "@/api/applications";
import * as candidatesApi from "@/api/candidates";
import { ApiError } from "@/api/client";
import * as interviewsApi from "@/api/interviews";
import * as joiningApi from "@/api/joining";
import * as offersApi from "@/api/offers";
import * as resumeScreeningApi from "@/api/resumeScreening";
import type { ApplicationRead, CandidateRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import * as jobPostingLookup from "@/hooks/useJobPostingLookup";
import { ApplicationDetailPage } from "@/pages/ApplicationDetailPage";

vi.mock("@/api/applications");
vi.mock("@/api/candidates");
vi.mock("@/api/interviews");
vi.mock("@/api/offers");
vi.mock("@/api/joining");
vi.mock("@/api/employees");
vi.mock("@/api/resumeScreening");
vi.mock("@/hooks/useJobPostingLookup");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedGetApplication = vi.mocked(applicationsApi.getApplication);
const mockedGetCandidate = vi.mocked(candidatesApi.getCandidate);
const mockedListInterviews = vi.mocked(interviewsApi.listInterviews);
const mockedListOffers = vi.mocked(offersApi.listOffers);
const mockedGetJoiningRecord = vi.mocked(joiningApi.getJoiningRecord);
const mockedListJoiningDocuments = vi.mocked(joiningApi.listJoiningDocuments);
const mockedUseJobPostingLookup = vi.mocked(jobPostingLookup.useJobPostingLookup);
const mockedGetResumeScore = vi.mocked(resumeScreeningApi.getResumeScore);
const mockedScreenApplication = vi.mocked(resumeScreeningApi.screenApplication);

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

function makeApplication(overrides: Partial<ApplicationRead> = {}): ApplicationRead {
  return {
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
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/applications/app-1"]}>
        <Routes>
          <Route path="/applications/:id" element={<ApplicationDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGetCandidate.mockResolvedValue(CANDIDATE);
  mockedUseJobPostingLookup.mockReturnValue({
    getLabel: () => ({ positionTitle: "Assistant Professor", campusId: "c-sse", slug: "slug-1" }),
    jobPostings: [],
    isLoading: false,
  });
  mockedListInterviews.mockResolvedValue([]);
  mockedListOffers.mockResolvedValue([]);
  mockedGetJoiningRecord.mockResolvedValue({
    id: "jr-1",
    application_id: "app-1",
    joining_date: "2026-03-01",
    actual_joining_date: null,
    onboarding_completed_at: null,
    onboarding_completed_by_id: null,
    created_at: "2026-01-02T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  });
  mockedListJoiningDocuments.mockResolvedValue([]);
  mockedGetResumeScore.mockRejectedValue(new ApiError(404, "Not found"));
});

describe("ApplicationDetailPage", () => {
  it("shows advance and reject controls, but not force-correct, for HR Admin", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetApplication.mockResolvedValue(makeApplication());

    renderPage();

    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.getByText("Reject")).toBeInTheDocument();
    expect(screen.getByText("Advance to")).toBeInTheDocument();
    expect(screen.queryByText("Force correct status")).not.toBeInTheDocument();
  });

  it("shows force-correct for Super Admin", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetApplication.mockResolvedValue(makeApplication());

    renderPage();

    await waitFor(() => expect(screen.getByText("Force correct status")).toBeInTheDocument());
  });

  it("hides advance/reject controls for a read-only role", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetApplication.mockResolvedValue(makeApplication());

    renderPage();

    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.queryByText("Reject")).not.toBeInTheDocument();
    expect(screen.queryByText("Advance to")).not.toBeInTheDocument();
  });

  // RBAC permission-gate audit (2026-08-24): transition_application_status
  // and update_pipeline_details are both gated by
  // require_permission(MANAGE_APPLICATIONS), not WRITE_ROLES alone -- this
  // locks in the fix without changing the "read-only role" test above (no
  // grant passed there, so it behaves exactly as before).
  it("shows advance/reject controls to a read-only role individually granted MANAGE_APPLICATIONS", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
      hasPermission: (permission) => permission === "MANAGE_APPLICATIONS",
    });
    mockedGetApplication.mockResolvedValue(makeApplication());

    renderPage();

    await waitFor(() => expect(screen.getByText("Reject")).toBeInTheDocument());
    expect(screen.getByText("Advance to")).toBeInTheDocument();
  });

  it("hides advance/reject controls once the application is terminal", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetApplication.mockResolvedValue(makeApplication({ status: "REJECTED", rejection_reason: "No match" }));

    renderPage();

    await waitFor(() => expect(screen.getByText("No match")).toBeInTheDocument());
    expect(screen.queryByText("Reject")).not.toBeInTheDocument();
    expect(screen.queryByText("Advance to")).not.toBeInTheDocument();
  });

  it("submits a reject with the entered reason", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetApplication.mockResolvedValue(makeApplication());
    const mockedTransition = vi.mocked(applicationsApi.transitionApplicationStatus);
    mockedTransition.mockResolvedValue(makeApplication({ status: "REJECTED" }));

    renderPage();
    await waitFor(() => expect(screen.getByText("Reject")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Reject"));
    await userEvent.type(screen.getByLabelText("Reason"), "Not qualified");
    await userEvent.click(screen.getByText("Confirm reject"));

    await waitFor(() =>
      expect(mockedTransition).toHaveBeenCalledWith("app-1", { status: "REJECTED", reason: "Not qualified" }),
    );
  });

  it("shows the Joining card once JOINING_CONFIRMED for HR Admin, but hides it for Campus HOD", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetApplication.mockResolvedValue(makeApplication({ status: "JOINING_CONFIRMED" }));

    const { unmount } = renderPage();
    await waitFor(() => expect(screen.getByText("Joining")).toBeInTheDocument());
    expect(screen.getByText("Mark joined")).toBeInTheDocument();
    unmount();

    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.queryByText("Joining")).not.toBeInTheDocument();
  });

  it("hides the Joining card before an offer has been accepted", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetApplication.mockResolvedValue(makeApplication({ status: "SELECTED" }));

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.queryByText("Joining")).not.toBeInTheDocument();
  });

  it("shows 'Not screened yet' and a disabled Screen button when the candidate has no resume", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetApplication.mockResolvedValue(makeApplication());

    renderPage();

    await waitFor(() => expect(screen.getByText("Not screened yet.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Screen resume" })).toBeDisabled();
    expect(screen.getByText("Candidate has no uploaded resume yet.")).toBeInTheDocument();
  });

  it("shows the Qualification Mismatch banner when flagged, including inside the reject dialog", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetApplication.mockResolvedValue(
      makeApplication({
        qualification_mismatch: true,
        qualification_mismatch_reason: "PhD-requiring Teaching position at SCAD has no active eligibility rule.",
      }),
    );

    renderPage();

    await waitFor(() => expect(screen.getAllByText("Qualification Mismatch").length).toBeGreaterThan(0));
    expect(
      screen.getByText("PhD-requiring Teaching position at SCAD has no active eligibility rule."),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByText("Reject"));

    // The banner is duplicated inside the reject dialog so a human sees the
    // reason before confirming a rejection -- there should now be 2 copies.
    await waitFor(() => expect(screen.getAllByText("Qualification Mismatch").length).toBe(2));
  });

  it("does not show the Qualification Mismatch banner when not flagged", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetApplication.mockResolvedValue(makeApplication({ qualification_mismatch: false }));

    renderPage();

    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.queryByText("Qualification Mismatch")).not.toBeInTheDocument();
  });

  it("enables screening and renders the score once the candidate has a resume and is screened", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetCandidate.mockResolvedValue({ ...CANDIDATE, resume_storage_key: "cand-1/resume.pdf" });
    mockedGetApplication.mockResolvedValue(makeApplication());
    mockedScreenApplication.mockResolvedValue({
      id: "score-1",
      application_id: "app-1",
      eligibility_score: 82.5,
      skill_match_pct: 75,
      qualification_match_pct: 90,
      experience_match_pct: 80,
      publication_count: 3,
      overall_recruitment_score: 81,
      semantic_similarity_score: 70,
      rationale: "Strong candidate.",
      extracted_skills: ["Python", "Teaching"],
      extracted_qualification: "PhD",
      extracted_experience_years: 5,
      is_duplicate: false,
      duplicate_of_candidate_id: null,
      is_incomplete_profile: false,
      incomplete_reasons: null,
      screened_at: "2026-01-03T00:00:00Z",
      screened_by_id: "u-1",
      model_version: "gpt-4o",
      created_at: "2026-01-03T00:00:00Z",
      updated_at: "2026-01-03T00:00:00Z",
    });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Screen resume" })).not.toBeDisabled());

    await userEvent.click(screen.getByRole("button", { name: "Screen resume" }));

    await waitFor(() => expect(mockedScreenApplication).toHaveBeenCalledWith("app-1"));
  });

  describe("PhD mandate override", () => {
    const flagged = () =>
      makeApplication({
        status: "SCREENING",
        qualification_mismatch: true,
        qualification_mismatch_reason:
          "PhD is mandatory for teaching posts at SSE; the resume shows: M.E. Computer Science. HR can override this with a reason.",
      });

    it("offers HR Admin an override reason and sends it with the status change", async () => {
      mockedUseAuth.mockReturnValue({
        user: { role: "HR_ADMIN" } as UserRead,
        isLoading: false,
        login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
        logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
      });
      mockedGetApplication.mockResolvedValue(flagged());
      const mockedTransition = vi.mocked(applicationsApi.transitionApplicationStatus);
      mockedTransition.mockClear();
      mockedTransition.mockResolvedValue(makeApplication({ status: "CALLED_FOR_INTERVIEW" }));

      renderPage();

      await waitFor(() => expect(screen.getByLabelText("PhD rule override reason (HR)")).toBeInTheDocument());
      expect(screen.getByText(/cannot be called for interview/i)).toBeInTheDocument();

      await userEvent.type(screen.getByLabelText("PhD rule override reason (HR)"), "Director approved");
      await userEvent.click(screen.getByRole("combobox", { name: "Advance to" }));
      await userEvent.click(await screen.findByRole("option", { name: "CALLED FOR INTERVIEW" }));
      await userEvent.click(screen.getByText("Update status"));

      await waitFor(() => expect(mockedTransition).toHaveBeenCalledTimes(1));
      expect(mockedTransition).toHaveBeenCalledWith("app-1", {
        status: "CALLED_FOR_INTERVIEW",
        eligibility_override_reason: "Director approved",
      });
    });

    it("does not offer the override to a Recruitment Officer", async () => {
      mockedUseAuth.mockReturnValue({
        user: { role: "RECRUITMENT_OFFICER", campus_id: "c-sse" } as UserRead,
        isLoading: false,
        login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
        logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
      });
      mockedGetApplication.mockResolvedValue(flagged());

      renderPage();

      await waitFor(() => expect(screen.getAllByText("Qualification Mismatch").length).toBeGreaterThan(0));
      expect(screen.queryByLabelText("PhD rule override reason (HR)")).not.toBeInTheDocument();
    });
  });
});
