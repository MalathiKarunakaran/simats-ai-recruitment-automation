import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as candidatesApi from "@/api/candidates";
import type { CandidateRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { CandidatesListPage } from "@/pages/CandidatesListPage";

vi.mock("@/api/candidates");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListCandidates = vi.mocked(candidatesApi.listCandidates);

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

describe("CandidatesListPage", () => {
  it("renders candidates from the API response", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedListCandidates.mockResolvedValue([CANDIDATE]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
  });

  it("shows the create button for HR Admin but not for an unrelated role", async () => {
    mockedListCandidates.mockResolvedValue([]);

    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    const { unmount } = renderPage();
    await waitFor(() => expect(screen.getByText("New candidate")).toBeInTheDocument());
    unmount();

    mockedUseAuth.mockReturnValue({
      user: { role: "INTERVIEW_PANEL_MEMBER" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/No candidates found/)).toBeInTheDocument());
    expect(screen.queryByText("New candidate")).not.toBeInTheDocument();
  });
});
