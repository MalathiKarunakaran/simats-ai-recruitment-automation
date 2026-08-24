import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as applicationsApi from "@/api/applications";
import * as candidatesApi from "@/api/candidates";
import type { ApplicationRead, CandidateRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import * as jobPostingLookup from "@/hooks/useJobPostingLookup";
import { CandidateDetailPage } from "@/pages/CandidateDetailPage";

vi.mock("@/api/candidates");
vi.mock("@/api/applications");
vi.mock("@/hooks/useJobPostingLookup");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedGetCandidate = vi.mocked(candidatesApi.getCandidate);
const mockedListApplications = vi.mocked(applicationsApi.listApplications);
const mockedWithdrawCandidate = vi.mocked(candidatesApi.withdrawCandidate);
const mockedUpdateCandidate = vi.mocked(candidatesApi.updateCandidate);
const mockedUseJobPostingLookup = vi.mocked(jobPostingLookup.useJobPostingLookup);
const mockedUseAuth = vi.mocked(authContext.useAuth);

function mockUser(role: UserRead["role"] | null, hasPermission: (permission: string) => boolean = () => false) {
  mockedUseAuth.mockReturnValue({
    user: role ? ({ role } as UserRead) : null,
    isLoading: false,
    login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
    logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    hasPermission,
  });
}

const CANDIDATE: CandidateRead = {
  id: "cand-1",
  full_name: "Jane Doe",
  email: "jane@example.com",
  phone_number: "+91 9876543210",
  resume_storage_key: null,
  source: "Referral",
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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/candidates/cand-1"]}>
        <Routes>
          <Route path="/candidates/:id" element={<CandidateDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CandidateDetailPage", () => {
  it("shows the profile, an upload prompt with no resume, and linked applications", async () => {
    mockUser("HR_ADMIN");
    mockedGetCandidate.mockResolvedValue(CANDIDATE);
    mockedListApplications.mockResolvedValue([APPLICATION]);
    mockedUseJobPostingLookup.mockReturnValue({
      getLabel: () => ({ positionTitle: "Assistant Professor", campusId: "c-sse", slug: "slug-1" }),
      jobPostings: [],
      isLoading: false,
    });

    renderPage();

    await waitFor(() => expect(screen.getByText("jane@example.com")).toBeInTheDocument());
    expect(screen.getByText("No resume uploaded yet.")).toBeInTheDocument();
    expect(screen.getByText("Upload resume")).toBeInTheDocument();
    expect(screen.getByText("Assistant Professor")).toBeInTheDocument();
  });

  it("shows a download button when a resume already exists", async () => {
    mockUser("HR_ADMIN");
    mockedGetCandidate.mockResolvedValue({ ...CANDIDATE, resume_storage_key: "cand-1/resume.pdf" });
    mockedListApplications.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });

    renderPage();

    await waitFor(() => expect(screen.getByText("resume.pdf")).toBeInTheDocument());
    expect(screen.getByText("Download")).toBeInTheDocument();
    expect(screen.getByText("Replace resume")).toBeInTheDocument();
  });

  it("shows the Active status badge and a Withdraw button for a recruitment officer", async () => {
    mockUser("RECRUITMENT_OFFICER");
    mockedGetCandidate.mockResolvedValue(CANDIDATE);
    mockedListApplications.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });

    renderPage();

    await waitFor(() => expect(screen.getByText("Active")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
    expect(screen.queryByText("Withdrawal details")).not.toBeInTheDocument();
  });

  it("hides the Withdraw button for a non-manage role", async () => {
    mockUser("CAMPUS_HOD");
    mockedGetCandidate.mockResolvedValue(CANDIDATE);
    mockedListApplications.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });

    renderPage();

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
  });

  // RBAC permission-gate audit (2026-08-24): update_candidate and
  // withdraw_candidate are both gated by require_permission(EDIT_CANDIDATE),
  // not CAN_MANAGE_CANDIDATES_ROLES alone -- this locks in the fix without
  // changing the "hides the Withdraw button" test above (no grant passed,
  // so behaves exactly as before).
  it("shows the Withdraw button to a role outside CAN_MANAGE_CANDIDATES_ROLES individually granted EDIT_CANDIDATE", async () => {
    mockUser("CAMPUS_HOD", (permission) => permission === "EDIT_CANDIDATE");
    mockedGetCandidate.mockResolvedValue(CANDIDATE);
    mockedListApplications.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });

    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument());
  });

  it("shows withdrawal details instead of the Withdraw button once withdrawn", async () => {
    mockUser("HR_ADMIN");
    mockedGetCandidate.mockResolvedValue({
      ...CANDIDATE,
      is_withdrawn: true,
      withdrawn_at: "2026-06-01T00:00:00Z",
      withdrawn_reason: "Accepted another offer",
    });
    mockedListApplications.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });

    renderPage();

    await waitFor(() => expect(screen.getByText("Withdrawal details")).toBeInTheDocument());
    expect(screen.getByText("Accepted another offer")).toBeInTheDocument();
    expect(screen.getByText("Withdrawn")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
  });

  it("submits a withdraw request with the entered reason", async () => {
    mockUser("HR_ADMIN");
    mockedGetCandidate.mockResolvedValue(CANDIDATE);
    mockedListApplications.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });
    mockedWithdrawCandidate.mockResolvedValue({
      ...CANDIDATE,
      is_withdrawn: true,
      withdrawn_at: "2026-06-01T00:00:00Z",
      withdrawn_reason: "Accepted another offer",
    });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    await userEvent.type(screen.getByLabelText("Reason"), "Accepted another offer");
    await userEvent.click(screen.getByRole("button", { name: "Confirm withdraw" }));

    await waitFor(() =>
      expect(mockedWithdrawCandidate).toHaveBeenCalledWith("cand-1", { reason: "Accepted another offer" }),
    );
  });

  it("hides the Edit button for a non-manage role", async () => {
    mockUser("CAMPUS_HOD");
    mockedGetCandidate.mockResolvedValue(CANDIDATE);
    mockedListApplications.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });

    renderPage();

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("submits an edit with the updated fields for a manage role", async () => {
    mockUser("HR_ADMIN");
    mockedGetCandidate.mockResolvedValue(CANDIDATE);
    mockedListApplications.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });
    mockedUpdateCandidate.mockResolvedValue({ ...CANDIDATE, full_name: "Jane A. Doe" });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const nameInput = screen.getByLabelText("Full name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Jane A. Doe");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mockedUpdateCandidate).toHaveBeenCalledWith("cand-1", {
        full_name: "Jane A. Doe",
        email: "jane@example.com",
        phone_number: "+91 9876543210",
        source: "Referral",
        reference_name: null,
      }),
    );
  });

  it("requires a reference name once source is switched to Reference", async () => {
    mockUser("HR_ADMIN");
    mockedGetCandidate.mockResolvedValue(CANDIDATE);
    mockedListApplications.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });
    // vitest doesn't auto-clear mock call history between tests in this
    // project (no clearMocks in vite.config.ts) -- reset this mock's own
    // call log explicitly so an earlier test's successful save doesn't leak
    // into this test's "never called" assertion below.
    mockedUpdateCandidate.mockClear();

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: "Reference" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      screen.getByText("Reference name is required when source is Reference"),
    ).toBeInTheDocument();
    expect(mockedUpdateCandidate).not.toHaveBeenCalled();
  });
});
