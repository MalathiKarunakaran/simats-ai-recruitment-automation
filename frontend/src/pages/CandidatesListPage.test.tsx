import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  reference_name: null,
  is_withdrawn: false,
  withdrawn_at: null,
  withdrawn_reason: null,
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
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
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
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    const { unmount } = renderPage();
    await waitFor(() => expect(screen.getByText("New candidate")).toBeInTheDocument());
    unmount();

    mockedUseAuth.mockReturnValue({
      user: { role: "INTERVIEW_PANEL_MEMBER" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/No candidates found/)).toBeInTheDocument());
    expect(screen.queryByText("New candidate")).not.toBeInTheDocument();
  });

  it("renders a status badge per row", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedListCandidates.mockResolvedValue([
      CANDIDATE,
      { ...CANDIDATE, id: "cand-2", full_name: "John Smith", is_withdrawn: true },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Withdrawn")).toBeInTheDocument();
  });

  it("threads the status filter into listCandidates as isWithdrawn", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedListCandidates.mockResolvedValue([CANDIDATE]);

    renderPage();
    await waitFor(() => expect(mockedListCandidates).toHaveBeenCalledWith(undefined, undefined));

    await userEvent.click(screen.getByRole("combobox", { name: "Status filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Withdrawn" }));

    await waitFor(() => expect(mockedListCandidates).toHaveBeenCalledWith(undefined, true));
  });

  it("narrows the list client-side by a name-or-email search without re-fetching", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    const other = { ...CANDIDATE, id: "cand-2", full_name: "John Smith", email: "john@example.com" };
    mockedListCandidates.mockResolvedValue([CANDIDATE, other]);

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
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    const withResume = { ...CANDIDATE, id: "cand-2", full_name: "Has Resume", resume_storage_key: "resumes/cand-2.pdf" };
    mockedListCandidates.mockResolvedValue([CANDIDATE, withResume]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("Has Resume")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Resume filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Resume: Missing" }));

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.queryByText("Has Resume")).not.toBeInTheDocument();
  });

  it("shows a filters-specific empty state when filters narrow a non-empty list to zero", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedListCandidates.mockResolvedValue([CANDIDATE]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText("Search by name or email"), "nonexistent");

    expect(await screen.findByText("No candidates match these filters.")).toBeInTheDocument();
  });
});
