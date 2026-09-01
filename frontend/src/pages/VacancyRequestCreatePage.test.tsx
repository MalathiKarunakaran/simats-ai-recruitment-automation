import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { VacancyRequestCreatePage } from "@/pages/VacancyRequestCreatePage";

vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

// The wizard itself is covered by its own tests and pulls in the whole
// master-data API surface; this page is only a route-level permission gate,
// so stub it out and assert on which branch renders.
vi.mock("@/components/vacancy-requests/VacancyRequestWizard", () => ({
  VacancyRequestWizard: () => <div>wizard</div>,
}));

const mockedUseAuth = vi.mocked(authContext.useAuth);

function mockAuth(role: string, granted?: string) {
  mockedUseAuth.mockReturnValue({
    user: { role } as UserRead,
    isLoading: false,
    login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
    logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    ...(granted ? { hasPermission: (permission: string) => permission === granted } : {}),
  } as ReturnType<typeof authContext.useAuth>);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <VacancyRequestCreatePage />
    </MemoryRouter>,
  );
}

describe("VacancyRequestCreatePage", () => {
  // Mirrors the backend's _can_create gate: CAMPUS_HOD/SUPER_ADMIN by role,
  // OR anyone individually granted CREATE_VACANCY_REQUEST. EDIT_ is the
  // other half of the same split and must NOT open this page.
  it("renders the wizard for a CAMPUS_HOD", () => {
    mockAuth("CAMPUS_HOD");
    renderPage();
    expect(screen.getByText("wizard")).toBeInTheDocument();
  });

  it("renders the wizard for an unrelated role granted CREATE_VACANCY_REQUEST", () => {
    mockAuth("RECRUITMENT_OFFICER", "CREATE_VACANCY_REQUEST");
    renderPage();
    expect(screen.getByText("wizard")).toBeInTheDocument();
  });

  it("refuses an unrelated role holding only EDIT_VACANCY_REQUEST", () => {
    mockAuth("RECRUITMENT_OFFICER", "EDIT_VACANCY_REQUEST");
    renderPage();
    expect(screen.queryByText("wizard")).not.toBeInTheDocument();
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
  });

  it("refuses an unrelated role with no grant at all", () => {
    mockAuth("INTERVIEW_PANEL_MEMBER");
    renderPage();
    expect(screen.queryByText("wizard")).not.toBeInTheDocument();
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
  });
});
