import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { CandidateCreatePage } from "@/pages/CandidateCreatePage";

vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);

function mockUser(role: UserRead["role"] | null, hasPermission: (permission: string) => boolean = () => false) {
  mockedUseAuth.mockReturnValue({
    user: role ? ({ role } as UserRead) : null,
    isLoading: false,
    login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
    logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    hasPermission,
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CandidateCreatePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// RBAC permission-gate audit (2026-08-24): create_candidate is gated by
// require_permission(CREATE_CANDIDATE), not CAN_CREATE_ROLES alone -- these
// two lock in the fix (both directions) with no pre-existing test file for
// this page to build on.
describe("CandidateCreatePage", () => {
  it("blocks a role outside CAN_CREATE_ROLES with no CREATE_CANDIDATE grant", () => {
    mockUser("CAMPUS_HOD");

    renderPage();

    expect(
      screen.getByText(
        "Only a Recruitment Officer, HR Admin, Super Admin, or Recruitment Coordinator can add a new candidate.",
      ),
    ).toBeInTheDocument();
  });

  it("unblocks a role outside CAN_CREATE_ROLES individually granted CREATE_CANDIDATE", async () => {
    mockUser("CAMPUS_HOD", (permission) => permission === "CREATE_CANDIDATE");

    renderPage();

    await waitFor(() => expect(screen.getByRole("heading", { name: "New candidate" })).toBeInTheDocument());
    expect(screen.getByLabelText("Full name")).toBeInTheDocument();
  });

  it("shows the form for a role already in CAN_CREATE_ROLES", async () => {
    mockUser("HR_ADMIN");

    renderPage();

    await waitFor(() => expect(screen.getByRole("heading", { name: "New candidate" })).toBeInTheDocument());
  });
});
