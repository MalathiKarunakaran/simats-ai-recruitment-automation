import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as applicationsApi from "@/api/applications";
import * as candidatesApi from "@/api/candidates";
import type { ApplicationRead, CandidateRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import * as jobPostingLookup from "@/hooks/useJobPostingLookup";
import { ApplicationDetailPage } from "@/pages/ApplicationDetailPage";

vi.mock("@/api/applications");
vi.mock("@/api/candidates");
vi.mock("@/hooks/useJobPostingLookup");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedGetApplication = vi.mocked(applicationsApi.getApplication);
const mockedGetCandidate = vi.mocked(candidatesApi.getCandidate);
const mockedUseJobPostingLookup = vi.mocked(jobPostingLookup.useJobPostingLookup);

const CANDIDATE: CandidateRead = {
  id: "cand-1",
  full_name: "Jane Doe",
  email: "jane@example.com",
  phone_number: null,
  resume_storage_key: null,
  source: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function makeApplication(overrides: Partial<ApplicationRead> = {}): ApplicationRead {
  return {
    id: "app-1",
    candidate_id: "cand-1",
    job_posting_id: "jp-1",
    campus_id: "c-sse",
    status: "APPLIED",
    applied_at: "2026-01-02T00:00:00Z",
    recorded_by_id: "u-1",
    rejection_reason: null,
    rejected_at: null,
    created_at: "2026-01-02T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/applications/app-1"]}>
        <Routes>
          <Route path="/applications/:id" element={<ApplicationDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGetCandidate.mockResolvedValue(CANDIDATE);
  mockedUseJobPostingLookup.mockReturnValue({
    getLabel: () => ({ positionTitle: "Assistant Professor", campusId: "c-sse", slug: "slug-1" }),
    jobPostings: [],
    isLoading: false,
  });
});

describe("ApplicationDetailPage", () => {
  it("shows advance and reject controls, but not force-correct, for HR Admin", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetApplication.mockResolvedValue(makeApplication());

    renderPage();

    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.getByText("Reject")).toBeInTheDocument();
    expect(screen.getByText("Advance to")).toBeInTheDocument();
    expect(screen.queryByText("Force correct status")).not.toBeInTheDocument();
  });

  it("shows force-correct for Super Admin", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetApplication.mockResolvedValue(makeApplication());

    renderPage();

    await waitFor(() => expect(screen.getByText("Force correct status")).toBeInTheDocument());
  });

  it("hides advance/reject controls for a read-only role", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetApplication.mockResolvedValue(makeApplication());

    renderPage();

    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.queryByText("Reject")).not.toBeInTheDocument();
    expect(screen.queryByText("Advance to")).not.toBeInTheDocument();
  });

  it("hides advance/reject controls once the application is terminal", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetApplication.mockResolvedValue(makeApplication({ status: "REJECTED", rejection_reason: "No match" }));

    renderPage();

    await waitFor(() => expect(screen.getByText("No match")).toBeInTheDocument());
    expect(screen.queryByText("Reject")).not.toBeInTheDocument();
    expect(screen.queryByText("Advance to")).not.toBeInTheDocument();
  });

  it("submits a reject with the entered reason", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetApplication.mockResolvedValue(makeApplication());
    const mockedTransition = vi.mocked(applicationsApi.transitionApplicationStatus);
    mockedTransition.mockResolvedValue(makeApplication({ status: "REJECTED" }));

    renderPage();
    await waitFor(() => expect(screen.getByText("Reject")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Reject"));
    await userEvent.type(screen.getByLabelText("Reason"), "Not qualified");
    await userEvent.click(screen.getByText("Confirm reject"));

    await waitFor(() =>
      expect(mockedTransition).toHaveBeenCalledWith("app-1", { status: "REJECTED", reason: "Not qualified" }),
    );
  });
});
