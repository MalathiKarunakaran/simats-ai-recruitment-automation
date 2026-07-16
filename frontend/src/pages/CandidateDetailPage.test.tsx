import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as applicationsApi from "@/api/applications";
import * as candidatesApi from "@/api/candidates";
import type { ApplicationRead, CandidateRead } from "@/api/types";
import * as jobPostingLookup from "@/hooks/useJobPostingLookup";
import { CandidateDetailPage } from "@/pages/CandidateDetailPage";

vi.mock("@/api/candidates");
vi.mock("@/api/applications");
vi.mock("@/hooks/useJobPostingLookup");

const mockedGetCandidate = vi.mocked(candidatesApi.getCandidate);
const mockedListApplications = vi.mocked(applicationsApi.listApplications);
const mockedUseJobPostingLookup = vi.mocked(jobPostingLookup.useJobPostingLookup);

const CANDIDATE: CandidateRead = {
  id: "cand-1",
  full_name: "Jane Doe",
  email: "jane@example.com",
  phone_number: "+91 9876543210",
  resume_storage_key: null,
  source: "Referral",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const APPLICATION: ApplicationRead = {
  id: "app-1",
  candidate_id: "cand-1",
  job_posting_id: "jp-1",
  campus_id: "c-sse",
  status: "SHORTLISTED",
  applied_at: "2026-01-02T00:00:00Z",
  recorded_by_id: "u-1",
  rejection_reason: null,
  rejected_at: null,
  withdrawn_reason: null,
  withdrawn_at: null,
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
    mockedGetCandidate.mockResolvedValue({ ...CANDIDATE, resume_storage_key: "cand-1/resume.pdf" });
    mockedListApplications.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });

    renderPage();

    await waitFor(() => expect(screen.getByText("resume.pdf")).toBeInTheDocument());
    expect(screen.getByText("Download")).toBeInTheDocument();
    expect(screen.getByText("Replace resume")).toBeInTheDocument();
  });
});
