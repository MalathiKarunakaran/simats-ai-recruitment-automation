import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as applicationsApi from "@/api/applications";
import * as candidatesApi from "@/api/candidates";
import * as jobPostingsApi from "@/api/jobPostings";
import type { ApplicationRead, CandidateRead, JobPostingRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import * as jobPostingLookup from "@/hooks/useJobPostingLookup";
import { ApplicationCreatePage } from "@/pages/ApplicationCreatePage";

vi.mock("@/api/applications");
vi.mock("@/api/candidates");
vi.mock("@/api/jobPostings");
vi.mock("@/hooks/useJobPostingLookup");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListCandidates = vi.mocked(candidatesApi.listCandidates);
const mockedListJobPostings = vi.mocked(jobPostingsApi.listJobPostings);
const mockedCreateApplication = vi.mocked(applicationsApi.createApplication);
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

const JOB_POSTING: JobPostingRead = {
  id: "jp-1",
  approved_vacancy_id: "av-1",
  campus_id: "c-sse",
  public_apply_slug: "assistant-professor",
  published_at: "2026-01-01T00:00:00Z",
  closed_at: null,
  is_active: true,
  position_title: "Assistant Professor",
  department_id: "d-cse",
  requested_count: 2,
  available_count: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ApplicationCreatePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ApplicationCreatePage", () => {
  it("blocks access for a role without write access", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedListCandidates.mockResolvedValue([]);
    mockedListJobPostings.mockResolvedValue([]);
    mockedUseJobPostingLookup.mockReturnValue({ getLabel: () => undefined, jobPostings: [], isLoading: false });

    renderPage();
    expect(screen.getByText(/Only a Recruitment Officer/)).toBeInTheDocument();
  });

  it("creates an application once a candidate and job posting are selected", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedListCandidates.mockResolvedValue([CANDIDATE]);
    mockedListJobPostings.mockResolvedValue([JOB_POSTING]);
    mockedUseJobPostingLookup.mockReturnValue({
      getLabel: () => ({ positionTitle: "Assistant Professor", campusId: "c-sse", slug: "assistant-professor" }),
      jobPostings: [JOB_POSTING],
      isLoading: false,
    });
    mockedCreateApplication.mockResolvedValue({ id: "app-1" } as ApplicationRead);

    renderPage();

    await userEvent.type(screen.getByPlaceholderText(/Search candidates/), "Jane");
    await userEvent.click(await screen.findByText("Jane Doe"));

    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: "Assistant Professor" }));

    await userEvent.click(screen.getByText("Record application"));

    await waitFor(() =>
      expect(mockedCreateApplication).toHaveBeenCalledWith({ candidate_id: "cand-1", job_posting_id: "jp-1" }),
    );
  });
});
