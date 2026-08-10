import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import * as sanctionedStrengthApi from "@/api/sanctionedStrength";
import type { UserRead, UserRole } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { SanctionedStrengthPage } from "@/pages/SanctionedStrengthPage";

// Exercises the exact old-path -> new-path redirect wired up in App.tsx:
//   <Route path="/sanctioned-strength" element={<SanctionedStrengthPage />} />
//   <Route path="/vacancy-requests/register" element={<Navigate to="/sanctioned-strength" replace />} />
// without standing up the full App tree (ProtectedRoute/AppShell chrome is
// exercised elsewhere) -- this isolates the React Router `Navigate`
// mechanics themselves, which is what's actually new/untested here.

vi.mock("@/api/sanctionedStrength");
vi.mock("@/api/campuses");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedListSanctionedStrengthRegister = vi.mocked(sanctionedStrengthApi.listSanctionedStrengthRegister);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedUseAuth = vi.mocked(authContext.useAuth);

function mockAuth(role: UserRole) {
  mockedUseAuth.mockReturnValue({
    user: { role } as UserRead,
    isLoading: false,
    login: vi.fn(),
    requestOtp: vi.fn(),
    loginWithOtp: vi.fn(),
    logout: vi.fn(),
  });
}

function RedirectTestRoutes() {
  return (
    <Routes>
      <Route path="/sanctioned-strength" element={<SanctionedStrengthPage />} />
      <Route path="/vacancy-requests/register" element={<Navigate to="/sanctioned-strength" replace />} />
    </Routes>
  );
}

describe("old Vacancy Register route redirect", () => {
  it("renders the Sanctioned Strength page's content when the old /vacancy-requests/register path is visited", async () => {
    mockAuth("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([]);
    mockedListSanctionedStrengthRegister.mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
      category_counts: { TEACHING: 0, NON_TEACHING: 0, HOUSEKEEPING: 0, ALL: 0 },
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/vacancy-requests/register"]}>
          <RedirectTestRoutes />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Sanctioned Strength" })).toBeInTheDocument();
    expect(
      screen.getByText("Sanctioned vs working strength per department. This defines how many posts may be requested."),
    ).toBeInTheDocument();
  });
});
