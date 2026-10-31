import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as candidatesApi from "@/api/candidates";
import type { CandidateRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { CandidateCreatePage } from "@/pages/CandidateCreatePage";

vi.mock("@/api/candidates");
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

  it("sends a multi-line address with the new candidate", async () => {
    mockUser("HR_ADMIN");
    const mockedCreate = vi.mocked(candidatesApi.createCandidate);
    mockedCreate.mockResolvedValue({ id: "cand-9" } as CandidateRead);

    renderPage();

    await userEvent.type(screen.getByLabelText("Full name"), "Ravi Kumar");
    await userEvent.type(screen.getByLabelText("Email"), "ravi@example.com");
    const addressBox = screen.getByLabelText("Address (optional)");
    expect(addressBox.tagName).toBe("TEXTAREA");
    await userEvent.type(addressBox, "7, Gandhi Road{enter}Vellore");
    await userEvent.click(screen.getByRole("button", { name: /create|save|add/i }));

    await waitFor(() =>
      expect(mockedCreate).toHaveBeenCalledWith(
        expect.objectContaining({ full_name: "Ravi Kumar", address: "7, Gandhi Road\nVellore" }),
      ),
    );
  });
});
