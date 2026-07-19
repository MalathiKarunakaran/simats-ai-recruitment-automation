import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as applicationsApi from "@/api/applications";
import * as candidatesApi from "@/api/candidates";
import * as offersApi from "@/api/offers";
import type { ApplicationRead, CandidateRead, OfferRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import * as jobPostingLookup from "@/hooks/useJobPostingLookup";
import { OffersListPage } from "@/pages/OffersListPage";

vi.mock("@/api/offers");
vi.mock("@/api/applications");
vi.mock("@/api/candidates");
vi.mock("@/hooks/useJobPostingLookup");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListOffers = vi.mocked(offersApi.listOffers);
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
  status: "SELECTED",
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

const OFFER: OfferRead = {
  id: "offer-1",
  application_id: "app-1",
  offered_by_id: "u-1",
  salary_amount: 90000,
  salary_currency: "INR",
  joining_date: "2026-03-01",
  terms: null,
  status: "DRAFT",
  sent_at: null,
  responded_at: null,
  decline_reason: null,
  expires_at: null,
  created_at: "2026-01-02T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OffersListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("OffersListPage", () => {
  it("renders offers joined with candidate and position labels for HR Admin", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedListOffers.mockResolvedValue([OFFER]);
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
    expect(screen.getByText("Make an offer")).toBeInTheDocument();
  });

  it("shows offers read-only for Management (no create button)", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "MANAGEMENT" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedListOffers.mockResolvedValue([OFFER]);
    mockedListApplications.mockResolvedValue([APPLICATION]);
    mockedListCandidates.mockResolvedValue([CANDIDATE]);
    mockedUseJobPostingLookup.mockReturnValue({
      getLabel: () => ({ positionTitle: "Assistant Professor", campusId: "c-sse", slug: "slug-1" }),
      jobPostings: [],
      isLoading: false,
    });

    renderPage();

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.queryByText("Make an offer")).not.toBeInTheDocument();
  });

  it("blocks the entire page for a role without view access", () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "RECRUITMENT_OFFICER" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });

    renderPage();

    expect(screen.getByText(/Only HR Admin, Super Admin, or Management/)).toBeInTheDocument();
  });
});
