import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as applicationsApi from "@/api/applications";
import * as candidatesApi from "@/api/candidates";
import * as offersApi from "@/api/offers";
import type { ApplicationRead, CandidateRead, OfferRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import * as jobPostingLookup from "@/hooks/useJobPostingLookup";
import { OfferDetailPage } from "@/pages/OfferDetailPage";

vi.mock("@/api/offers");
vi.mock("@/api/applications");
vi.mock("@/api/candidates");
vi.mock("@/hooks/useJobPostingLookup");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedGetOffer = vi.mocked(offersApi.getOffer);
const mockedGetApplication = vi.mocked(applicationsApi.getApplication);
const mockedGetCandidate = vi.mocked(candidatesApi.getCandidate);
const mockedDeclineOffer = vi.mocked(offersApi.declineOffer);
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

function makeOffer(overrides: Partial<OfferRead> = {}): OfferRead {
  return {
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
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/offers/offer-1"]}>
        <Routes>
          <Route path="/offers/:id" element={<OfferDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGetApplication.mockResolvedValue(APPLICATION);
  mockedGetCandidate.mockResolvedValue(CANDIDATE);
  mockedUseJobPostingLookup.mockReturnValue({
    getLabel: () => ({ positionTitle: "Assistant Professor", campusId: "c-sse", slug: "slug-1" }),
    jobPostings: [],
    isLoading: false,
  });
});

describe("OfferDetailPage", () => {
  it("shows only Send for a DRAFT offer", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetOffer.mockResolvedValue(makeOffer());

    renderPage();

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("Send")).toBeInTheDocument();
    expect(screen.queryByText("Accept")).not.toBeInTheDocument();
    expect(screen.queryByText("Decline")).not.toBeInTheDocument();
  });

  it("shows Accept/Decline/Withdraw/Mark expired for a SENT offer", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetOffer.mockResolvedValue(makeOffer({ status: "SENT" }));

    renderPage();

    await waitFor(() => expect(screen.getByText("Accept")).toBeInTheDocument());
    expect(screen.getByText("Decline")).toBeInTheDocument();
    expect(screen.getByText("Withdraw")).toBeInTheDocument();
    expect(screen.getByText("Mark expired")).toBeInTheDocument();
    expect(screen.queryByText("Send")).not.toBeInTheDocument();
  });

  it("shows no action buttons for a terminal ACCEPTED offer", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetOffer.mockResolvedValue(makeOffer({ status: "ACCEPTED" }));

    renderPage();

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.queryByText("Send")).not.toBeInTheDocument();
    expect(screen.queryByText("Accept")).not.toBeInTheDocument();
    expect(screen.queryByText("Decline")).not.toBeInTheDocument();
  });

  it("hides all actions for Management (read-only)", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "MANAGEMENT" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetOffer.mockResolvedValue(makeOffer({ status: "SENT" }));

    renderPage();

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.queryByText("Accept")).not.toBeInTheDocument();
    expect(screen.queryByText("Decline")).not.toBeInTheDocument();
  });

  it("requires a reason before confirming decline", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetOffer.mockResolvedValue(makeOffer({ status: "SENT" }));
    mockedDeclineOffer.mockResolvedValue(makeOffer({ status: "DECLINED" }));

    renderPage();
    await waitFor(() => expect(screen.getByText("Decline")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Decline"));
    const confirmButton = screen.getByText("Confirm decline");
    expect(confirmButton).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Reason"), "Chose another candidate");
    expect(confirmButton).not.toBeDisabled();
    await userEvent.click(confirmButton);

    await waitFor(() =>
      expect(mockedDeclineOffer).toHaveBeenCalledWith("offer-1", "Chose another candidate"),
    );
  });
});
