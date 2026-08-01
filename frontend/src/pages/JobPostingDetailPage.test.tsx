import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import * as jobDistributionApi from "@/api/jobDistribution";
import * as jobPostingsApi from "@/api/jobPostings";
import type { JobPostingRead, RankedApplicationRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import * as jobPostingLookup from "@/hooks/useJobPostingLookup";
import { JobPostingDetailPage } from "@/pages/JobPostingDetailPage";

vi.mock("@/api/jobPostings");
vi.mock("@/api/jobDistribution");
vi.mock("@/hooks/useJobPostingLookup");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedGetJobPosting = vi.mocked(jobPostingsApi.getJobPosting);
const mockedRankCandidates = vi.mocked(jobPostingsApi.rankCandidates);
const mockedUseJobPostingLookup = vi.mocked(jobPostingLookup.useJobPostingLookup);
const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedGetJobAd = vi.mocked(jobDistributionApi.getJobAd);
const mockedGetQrCodeBlob = vi.mocked(jobDistributionApi.getQrCodeBlob);
const mockedDistribute = vi.mocked(jobDistributionApi.distributeJobPosting);

const JOB_POSTING: JobPostingRead = {
  id: "jp-1",
  approved_vacancy_id: "av-1",
  campus_id: "c-sse",
  public_apply_slug: "slug-1",
  published_at: "2026-01-05T00:00:00Z",
  closed_at: null,
  is_active: true,
  position_title: "Assistant Professor",
  department_id: "d-cse",
  available_count: 2,
  required_count: 2,
  created_at: "2026-01-05T00:00:00Z",
  updated_at: "2026-01-05T00:00:00Z",
};

function makeRanked(overrides: Partial<RankedApplicationRead> = {}): RankedApplicationRead {
  return {
    application_id: "app-1",
    candidate_id: "cand-1",
    candidate_full_name: "Jane Doe",
    candidate_email: "jane@example.com",
    application_status: "SCREENING",
    overall_recruitment_score: 81,
    eligibility_score: 82.5,
    is_duplicate: false,
    is_incomplete_profile: false,
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/job-postings/jp-1"]}>
        <Routes>
          <Route path="/job-postings/:id" element={<JobPostingDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("JobPostingDetailPage", () => {
  it("renders ranked candidates in the returned order with a link to the application", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetJobPosting.mockResolvedValue(JOB_POSTING);
    mockedUseJobPostingLookup.mockReturnValue({
      getLabel: () => ({ positionTitle: "Assistant Professor", campusId: "c-sse", slug: "slug-1" }),
      jobPostings: [],
      isLoading: false,
    });
    mockedRankCandidates.mockResolvedValue([
      makeRanked({ application_id: "app-1", candidate_full_name: "High Scorer", overall_recruitment_score: 95 }),
      makeRanked({
        application_id: "app-2",
        candidate_full_name: "Low Scorer",
        overall_recruitment_score: 40,
        is_incomplete_profile: true,
      }),
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("High Scorer");
    expect(rows[2]).toHaveTextContent("Low Scorer");
    expect(screen.getByText("Incomplete")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /High Scorer/ });
    expect(link).toHaveAttribute("href", "/applications/app-1");
  });

  it("shows the empty-state message when no applications exist yet", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetJobPosting.mockResolvedValue(JOB_POSTING);
    mockedUseJobPostingLookup.mockReturnValue({
      getLabel: () => undefined,
      jobPostings: [],
      isLoading: false,
    });
    mockedRankCandidates.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText("No applications for this posting yet.")).toBeInTheDocument());
  });

  const JOB_AD = {
    job_posting_id: "jp-1",
    position_title: "Lecturer",
    campus_code: "SSE",
    employment_type: "FULL_TIME",
    role_category: "TEACHING",
    qualification: "PhD",
    experience_required: "3+ years",
    body: "SSE is hiring a Lecturer. Apply now!",
    apply_url: "https://apply.example.com/slug-1",
    public_apply_slug: "slug-1",
  };

  function mockNoRankedCandidates() {
    mockedGetJobPosting.mockResolvedValue(JOB_POSTING);
    mockedUseJobPostingLookup.mockReturnValue({
      getLabel: () => ({ positionTitle: "Lecturer", campusId: "c-sse", slug: "slug-1" }),
      jobPostings: [],
      isLoading: false,
    });
    mockedRankCandidates.mockResolvedValue([]);
  }

  it("does not show the Distribution card for a role outside the distribute-allowed set", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockNoRankedCandidates();

    renderPage();
    await waitFor(() => expect(screen.getByText("Posting")).toBeInTheDocument());

    expect(screen.queryByText("Distribution")).not.toBeInTheDocument();
    expect(mockedGetJobAd).not.toHaveBeenCalled();
  });

  it("shows the job ad text and lets HR Admin copy it", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockNoRankedCandidates();
    mockedGetJobAd.mockResolvedValue(JOB_AD);
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });

    renderPage();
    await waitFor(() => expect(screen.getByText(JOB_AD.body)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(JOB_AD.body);
  });

  it("generates the QR code and offers a download link", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "RECRUITMENT_OFFICER" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockNoRankedCandidates();
    mockedGetJobAd.mockResolvedValue(JOB_AD);
    mockedGetQrCodeBlob.mockResolvedValue(new Blob(["fake-png-bytes"], { type: "image/png" }));

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate QR code" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Generate QR code" }));

    expect(await screen.findByAltText("Apply QR code")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download PNG" })).toHaveAttribute(
      "download",
      "job-posting-jp-1-qr.png",
    );
  });

  it("distributes to the selected portals and shows which portals it was sent to", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockNoRankedCandidates();
    mockedGetJobAd.mockResolvedValue(JOB_AD);
    mockedDistribute.mockResolvedValue({ portals: ["LINKEDIN", "NAUKRI"], n8n_response: { ok: true } });

    renderPage();
    await waitFor(() => expect(screen.getByText("Distribute to portals")).toBeInTheDocument());

    // All 4 portals start selected -- deselect INDEED and FACULTYPLUS to send only LINKEDIN + NAUKRI.
    await userEvent.click(screen.getByRole("button", { name: "INDEED" }));
    await userEvent.click(screen.getByRole("button", { name: "FACULTYPLUS" }));
    await userEvent.click(screen.getByRole("button", { name: "Distribute" }));

    await waitFor(() => expect(mockedDistribute).toHaveBeenCalledWith("jp-1", ["LINKEDIN", "NAUKRI"]));
    expect(await screen.findByText("Sent to: LINKEDIN, NAUKRI")).toBeInTheDocument();
  });

  it("shows an error message when distribution isn't configured", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockNoRankedCandidates();
    mockedGetJobAd.mockResolvedValue(JOB_AD);
    mockedDistribute.mockRejectedValue(
      new ApiError(503, "Job-portal distribution is not configured (N8N_BASE_URL is not set)"),
    );

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Distribute" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Distribute" }));

    expect(
      await screen.findByText("Job-portal distribution is not configured (N8N_BASE_URL is not set)"),
    ).toBeInTheDocument();
  });
});
