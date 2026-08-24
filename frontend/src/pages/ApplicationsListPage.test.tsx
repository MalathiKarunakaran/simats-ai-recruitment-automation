import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
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

// Step 6 KPI strip -- same "scope getAllByText to the element actually
// inside a StatTile Card" convention as CandidatesListPage.test.tsx's own
// getKpiTile helper (see that file's docstring); no known label collision
// on this page today, but kept consistent in case one of these labels ever
// matches a StatusBadge/Select option string later.
function getKpiTile(label: string): HTMLElement {
  const matches = screen.getAllByText(label);
  const tile = matches.map((el) => el.closest(".rounded-xl")).find((el): el is HTMLElement => el !== null);
  if (!tile) throw new Error(`No KPI tile found for label "${label}"`);
  return tile;
}

describe("ApplicationsListPage", () => {
  it("renders applications joined with candidate and position labels", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
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
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
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
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListApplications.mockResolvedValue([]);
    mockedListCandidates.mockResolvedValue([]);
    mockedListCampuses.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });

    renderPage();
    await waitFor(() => expect(screen.getByText(/No applications/)).toBeInTheDocument());
    expect(screen.queryByText("New application")).not.toBeInTheDocument();
  });

  // RBAC permission-gate audit (2026-08-24): create_application is gated by
  // require_permission(MANAGE_APPLICATIONS), not CAN_CREATE_ROLES alone --
  // locks in the fix without changing the test above (no grant passed
  // there, so it behaves exactly as before).
  it("shows the create button to a role without write access individually granted MANAGE_APPLICATIONS", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
      hasPermission: (permission) => permission === "MANAGE_APPLICATIONS",
    });
    mockedListApplications.mockResolvedValue([]);
    mockedListCandidates.mockResolvedValue([]);
    mockedListCampuses.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });

    renderPage();

    await waitFor(() => expect(screen.getByText("New application")).toBeInTheDocument());
  });

  it("narrows the list client-side by campus without re-fetching", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
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
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
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
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
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

  it("shows funnel-stage KPI tiles reflecting the currently filtered rows, one bucket per application status", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    // One application per funnel bucket: APPLIED (applied), SCREENING (in
    // review), OFFER_SENT (selected/offer), JOINED (joined), REJECTED
    // (rejected/withdrawn) -- see the page's own IN_REVIEW_STATUSES/
    // SELECTED_OR_OFFER_STATUSES/JOINED_STATUSES/REJECTED_OR_WITHDRAWN_STATUSES.
    const inReview: ApplicationRead = { ...APPLICATION, id: "app-2", candidate_id: "cand-2", status: "SCREENING" };
    const selectedOrOffer: ApplicationRead = { ...APPLICATION, id: "app-3", candidate_id: "cand-3", status: "OFFER_SENT" };
    const joined: ApplicationRead = { ...APPLICATION, id: "app-4", candidate_id: "cand-4", status: "JOINED" };
    const rejected: ApplicationRead = { ...APPLICATION, id: "app-5", candidate_id: "cand-5", status: "REJECTED" };
    mockedListApplications.mockResolvedValue([APPLICATION, inReview, selectedOrOffer, joined, rejected]);
    mockedListCandidates.mockResolvedValue([
      CANDIDATE,
      { ...CANDIDATE, id: "cand-2", full_name: "Screening Candidate", email: "s@example.com" },
      { ...CANDIDATE, id: "cand-3", full_name: "Offer Candidate", email: "o@example.com" },
      { ...CANDIDATE, id: "cand-4", full_name: "Joined Candidate", email: "j@example.com" },
      { ...CANDIDATE, id: "cand-5", full_name: "Rejected Candidate", email: "r@example.com" },
    ]);
    mockedListCampuses.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({
      getLabel: () => ({ positionTitle: "Assistant Professor", campusId: "c-sse", slug: "slug-1" }),
      jobPostings: [],
      isLoading: false,
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());

    expect(within(getKpiTile("Total applications")).getByText("5")).toBeInTheDocument();
    expect(within(getKpiTile("Applied")).getByText("1")).toBeInTheDocument();
    expect(within(getKpiTile("In review")).getByText("1")).toBeInTheDocument();
    expect(within(getKpiTile("Selected / Offer")).getByText("1")).toBeInTheDocument();
    expect(within(getKpiTile("Joined")).getByText("1")).toBeInTheDocument();
    expect(within(getKpiTile("Rejected / Withdrawn")).getByText("1")).toBeInTheDocument();

    // Narrowing via search narrows the KPI strip identically -- only Jane
    // Doe's own APPLIED row matches "jane".
    await userEvent.type(screen.getByPlaceholderText("Search by candidate or position"), "jane");

    expect(within(getKpiTile("Total applications")).getByText("1")).toBeInTheDocument();
    expect(within(getKpiTile("Applied")).getByText("1")).toBeInTheDocument();
    expect(within(getKpiTile("In review")).getByText("0")).toBeInTheDocument();
    expect(within(getKpiTile("Joined")).getByText("0")).toBeInTheDocument();
  });
});
