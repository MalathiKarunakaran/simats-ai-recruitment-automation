import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as applicationsApi from "@/api/applications";
import * as candidatesApi from "@/api/candidates";
import type { ApplicationRead, CandidateRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { CandidatesListPage } from "@/pages/CandidatesListPage";

vi.mock("@/api/candidates");
vi.mock("@/api/applications");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListCandidates = vi.mocked(candidatesApi.listCandidates);
const mockedListApplications = vi.mocked(applicationsApi.listApplications);

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
        <CandidatesListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockAuth(role: UserRead["role"]) {
  mockedUseAuth.mockReturnValue({
    user: { role } as UserRead,
    isLoading: false,
    login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
    logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
  });
}

describe("CandidatesListPage", () => {
  it("renders candidates from the API response", async () => {
    mockAuth("HR_ADMIN");
    mockedListCandidates.mockResolvedValue([CANDIDATE]);
    mockedListApplications.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
  });

  it("shows the create button for HR Admin but not for an unrelated role", async () => {
    mockedListCandidates.mockResolvedValue([]);
    mockedListApplications.mockResolvedValue([]);

    mockAuth("HR_ADMIN");
    const { unmount } = renderPage();
    await waitFor(() => expect(screen.getByText("New candidate")).toBeInTheDocument());
    unmount();

    mockAuth("INTERVIEW_PANEL_MEMBER");
    renderPage();
    await waitFor(() => expect(screen.getByText(/No candidates found/)).toBeInTheDocument());
    expect(screen.queryByText("New candidate")).not.toBeInTheDocument();
  });

  it("renders a status badge per row", async () => {
    mockAuth("HR_ADMIN");
    mockedListCandidates.mockResolvedValue([
      CANDIDATE,
      { ...CANDIDATE, id: "cand-2", full_name: "John Smith", is_withdrawn: true },
    ]);
    mockedListApplications.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Withdrawn")).toBeInTheDocument();
  });

  it("threads the status filter into listCandidates as isWithdrawn", async () => {
    mockAuth("HR_ADMIN");
    mockedListCandidates.mockResolvedValue([CANDIDATE]);
    mockedListApplications.mockResolvedValue([]);

    renderPage();
    await waitFor(() => expect(mockedListCandidates).toHaveBeenCalledWith(undefined, undefined));

    await userEvent.click(screen.getByRole("combobox", { name: "Status filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Withdrawn" }));

    await waitFor(() => expect(mockedListCandidates).toHaveBeenCalledWith(undefined, true));
  });

  it("narrows the list client-side by a name-or-email search without re-fetching", async () => {
    mockAuth("HR_ADMIN");
    const other = { ...CANDIDATE, id: "cand-2", full_name: "John Smith", email: "john@example.com" };
    mockedListCandidates.mockResolvedValue([CANDIDATE, other]);
    mockedListApplications.mockResolvedValue([]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    const callCountBeforeSearch = mockedListCandidates.mock.calls.length;

    await userEvent.type(screen.getByPlaceholderText("Search by name or email"), "jane");

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.queryByText("John Smith")).not.toBeInTheDocument();
    expect(mockedListCandidates).toHaveBeenCalledTimes(callCountBeforeSearch);
  });

  it("narrows the list client-side by resume presence", async () => {
    mockAuth("HR_ADMIN");
    const withResume = { ...CANDIDATE, id: "cand-2", full_name: "Has Resume", resume_storage_key: "resumes/cand-2.pdf" };
    mockedListCandidates.mockResolvedValue([CANDIDATE, withResume]);
    mockedListApplications.mockResolvedValue([]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("Has Resume")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Resume filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Resume: Missing" }));

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.queryByText("Has Resume")).not.toBeInTheDocument();
  });

  it("shows a filters-specific empty state when filters narrow a non-empty list to zero", async () => {
    mockAuth("HR_ADMIN");
    mockedListCandidates.mockResolvedValue([CANDIDATE]);
    mockedListApplications.mockResolvedValue([]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText("Search by name or email"), "nonexistent");

    expect(await screen.findByText("No candidates match these filters.")).toBeInTheDocument();
  });

  it("filters candidates by a CategoryTabs tab using 'has at least one application in this category' semantics", async () => {
    mockAuth("HR_ADMIN");
    const teachingOnly = CANDIDATE;
    const nonTeachingOnly = { ...CANDIDATE, id: "cand-2", full_name: "John Smith", email: "john@example.com" };
    const noApplications = { ...CANDIDATE, id: "cand-3", full_name: "No Apps", email: "noapps@example.com" };
    mockedListCandidates.mockResolvedValue([teachingOnly, nonTeachingOnly, noApplications]);
    mockedListApplications.mockResolvedValue([
      APPLICATION, // cand-1, TEACHING
      { ...APPLICATION, id: "app-2", candidate_id: "cand-2", role_category: "NON_TEACHING" },
    ]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    expect(screen.getByText("No Apps")).toBeInTheDocument();

    // All (3) / Teaching (1) / Non-Teaching (1) / Housekeeping (0).
    expect(screen.getByRole("tab", { name: "All (3)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Teaching (1)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Non-Teaching (1)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Housekeeping (0)" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /^Teaching/ }));

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.queryByText("John Smith")).not.toBeInTheDocument();
    expect(screen.queryByText("No Apps")).not.toBeInTheDocument();
  });

  it("combines the category tab with the name search filter (both apply, not just one)", async () => {
    mockAuth("HR_ADMIN");
    const teachingJane = CANDIDATE;
    const teachingJohn = { ...CANDIDATE, id: "cand-2", full_name: "John Teaching", email: "johnt@example.com" };
    mockedListCandidates.mockResolvedValue([teachingJane, teachingJohn]);
    mockedListApplications.mockResolvedValue([
      APPLICATION,
      { ...APPLICATION, id: "app-2", candidate_id: "cand-2", role_category: "TEACHING" },
    ]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("tab", { name: /^Teaching/ }));
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("John Teaching")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Search by name or email"), "jane");

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.queryByText("John Teaching")).not.toBeInTheDocument();
  });
});
