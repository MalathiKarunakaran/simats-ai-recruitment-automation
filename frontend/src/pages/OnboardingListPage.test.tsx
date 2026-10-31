import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as applicationsApi from "@/api/applications";
import * as campusesApi from "@/api/campuses";
import * as candidatesApi from "@/api/candidates";
import * as joiningApi from "@/api/joining";
import type {
  ApplicationRead,
  ApplicationStatus,
  CandidateRead,
  OnboardingProbationRow,
  UserRead,
} from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import * as jobPostingLookup from "@/hooks/useJobPostingLookup";
import { OnboardingListPage } from "@/pages/OnboardingListPage";

vi.mock("@/api/applications");
vi.mock("@/api/candidates");
vi.mock("@/api/campuses");
vi.mock("@/api/joining");
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
const mockedListOnboardingProbation = vi.mocked(joiningApi.listOnboardingProbation);

beforeEach(() => {
  mockedListOnboardingProbation.mockResolvedValue([]);
});

function makeCandidate(overrides: Partial<CandidateRead>): CandidateRead {
  return {
    id: "cand-1",
    full_name: "Jane Doe",
    email: "jane@example.com",
    phone_number: null,
    address: null,
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
    role_category: "TEACHING",
    status: "JOINED",
    applied_at: "2026-01-02T00:00:00Z",
    recorded_by_id: "u-1",
    rejection_reason: null,
    rejected_at: null,
    rejection_category: null,
    rejected_at_stage: null,
    waitlist_rank: null,
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
      user: { role: "INTERVIEW_PANEL_MEMBER" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });
    mockedListCandidates.mockResolvedValue([]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage();

    expect(
      screen.getByText(/Only a Recruitment Officer, HR Admin, Recruitment Coordinator, Campus HOD, or Super Admin/),
    ).toBeInTheDocument();
  });

  // Bug fix (2026-08-24): CAN_VIEW_ROLES was missing RECRUITMENT_COORDINATOR,
  // unlike AppShell.tsx's own nav entry for this page (which already showed
  // the "Onboarding" link to RECRUITMENT_COORDINATOR) -- so this role could
  // click into a page that then blocked them. Locks in the fix rather than
  // just the blocked-role case above.
  it("allows a Recruitment Coordinator to view onboarding", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "RECRUITMENT_COORDINATOR" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });
    mockedListCandidates.mockResolvedValue([]);
    mockedListCampuses.mockResolvedValue([]);
    mockByStatus({});

    renderPage();

    expect(screen.queryByText(/can view onboarding/)).not.toBeInTheDocument();
    await waitFor(() => expect(mockedListApplications).toHaveBeenCalled());
  });

  it("renders applications across all 4 onboarding stages joined with candidate and position", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
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
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
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

  it("lists the provisional-order stage in its place and filters by it", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockByStatus({
      JOINED: [makeApplication({ id: "app-1", status: "JOINED" })],
      PROVISIONAL_ORDER_ISSUED: [
        makeApplication({ id: "app-2", candidate_id: "cand-2", status: "PROVISIONAL_ORDER_ISSUED" }),
      ],
    });
    mockedListCandidates.mockResolvedValue([CANDIDATE_JANE, makeCandidate({ id: "cand-2", full_name: "John Smith" })]);
    mockedListCampuses.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({
      getLabel: () => ({ positionTitle: "Assistant Professor", campusId: "c-sse", slug: "slug-1" }),
      jobPostings: [],
      isLoading: false,
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("John Smith")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "Stage filter" }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    // After department allotment (the letter prints the allotted department).
    expect(options.indexOf("PROVISIONAL ORDER ISSUED")).toBe(options.indexOf("DEPARTMENT ROOM ALLOTTED") + 1);
    await userEvent.click(screen.getByRole("option", { name: "PROVISIONAL ORDER ISSUED" }));

    expect(screen.queryByText("Jane Doe")).not.toBeInTheDocument();
    expect(screen.getByText("John Smith")).toBeInTheDocument();
  });

  it("narrows the list client-side by campus", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
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
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
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
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
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
  function hrAdmin() {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({
      getLabel: () => ({ positionTitle: "Assistant Professor", campusId: "c-sse", slug: "slug-1" }),
      jobPostings: [],
      isLoading: false,
    });
  }

  function probationRow(overrides: Partial<OnboardingProbationRow>): OnboardingProbationRow {
    return {
      application_id: "app-1",
      status: "HANDED_OVER_TO_HOD",
      joining_date: "2026-06-01",
      days_since_joining: 152,
      probation_end_date: "2026-09-01",
      latest_recommendation: null,
      past_probation_without_recommendation: false,
      ...overrides,
    };
  }

  it("lists the HOD-review stages after orientation, in order", async () => {
    hrAdmin();
    mockByStatus({ HOD_REVIEW_COMPLETE: [makeApplication({ id: "app-1", status: "HOD_REVIEW_COMPLETE" })] });
    mockedListCandidates.mockResolvedValue([CANDIDATE_JANE]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "Stage filter" }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    const at = options.indexOf("ORIENTATION COMPLETE");
    expect(options.slice(at + 1)).toEqual(["HANDED OVER TO HOD", "HOD REVIEW COMPLETE", "PERMANENT ORDER ISSUED"]);
  });

  it("shows days since joining and highlights and filters past-probation rows", async () => {
    hrAdmin();
    mockByStatus({
      HANDED_OVER_TO_HOD: [
        makeApplication({ id: "app-1", status: "HANDED_OVER_TO_HOD" }),
        makeApplication({ id: "app-2", candidate_id: "cand-2", status: "HANDED_OVER_TO_HOD" }),
      ],
    });
    mockedListCandidates.mockResolvedValue([CANDIDATE_JANE, makeCandidate({ id: "cand-2", full_name: "John Smith" })]);
    mockedListOnboardingProbation.mockResolvedValue([
      probationRow({ application_id: "app-1", days_since_joining: 152, past_probation_without_recommendation: true }),
      probationRow({ application_id: "app-2", days_since_joining: 20, probation_end_date: "2027-01-31" }),
    ]);

    renderPage();
    await waitFor(() => expect(screen.getByText("152")).toBeInTheDocument());
    expect(screen.getByRole("columnheader", { name: "Days since joining" })).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();

    const janeRow = screen.getByText("Jane Doe").closest("tr")!;
    const johnRow = screen.getByText("John Smith").closest("tr")!;
    expect(janeRow).toHaveAttribute("data-overdue", "true");
    expect(janeRow).toHaveTextContent("Probation ended 01-09-2026, no HOD recommendation");
    expect(johnRow).not.toHaveAttribute("data-overdue");

    await userEvent.click(screen.getByLabelText("Past probation, no HOD recommendation"));
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.queryByText("John Smith")).not.toBeInTheDocument();
  });

  it("gives a Campus HOD just the HOD-review stages", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });
    mockedListCandidates.mockResolvedValue([CANDIDATE_JANE]);
    mockedListApplications.mockClear();
    mockByStatus({ HANDED_OVER_TO_HOD: [makeApplication({ id: "app-1", status: "HANDED_OVER_TO_HOD" })] });

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());

    const requested = mockedListApplications.mock.calls.map(([filters]) => filters?.status);
    expect(new Set(requested)).toEqual(new Set(["HANDED_OVER_TO_HOD", "HOD_REVIEW_COMPLETE"]));
    await userEvent.click(screen.getByRole("combobox", { name: "Stage filter" }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["All stages", "HANDED OVER TO HOD", "HOD REVIEW COMPLETE"]);
  });
});
