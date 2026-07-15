import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as jobPostingsApi from "@/api/jobPostings";
import type { JobPostingRead, RankedApplicationRead } from "@/api/types";
import * as jobPostingLookup from "@/hooks/useJobPostingLookup";
import { JobPostingDetailPage } from "@/pages/JobPostingDetailPage";

vi.mock("@/api/jobPostings");
vi.mock("@/hooks/useJobPostingLookup");

const mockedGetJobPosting = vi.mocked(jobPostingsApi.getJobPosting);
const mockedRankCandidates = vi.mocked(jobPostingsApi.rankCandidates);
const mockedUseJobPostingLookup = vi.mocked(jobPostingLookup.useJobPostingLookup);

const JOB_POSTING: JobPostingRead = {
  id: "jp-1",
  approved_vacancy_id: "av-1",
  campus_id: "c-sse",
  public_apply_slug: "slug-1",
  published_at: "2026-01-05T00:00:00Z",
  closed_at: null,
  is_active: true,
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
});
