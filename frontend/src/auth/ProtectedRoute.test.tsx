import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { ProtectedRoute } from "@/auth/ProtectedRoute";

vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);

function renderProtected() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<div>dashboard page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute", () => {
  it("redirects to /login when not authenticated", () => {
    mockedUseAuth.mockReturnValue({ user: null, isLoading: false, login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(), logout: vi.fn() });

    renderProtected();

    expect(screen.getByText("login page")).toBeInTheDocument();
  });

  it("renders the protected content for a normal staff role", () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });

    renderProtected();

    expect(screen.getByText("dashboard page")).toBeInTheDocument();
  });

  it("renders the not-permitted page for a CANDIDATE role instead of the shell", () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CANDIDATE" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });

    renderProtected();

    expect(screen.getByText(/Not permitted/i)).toBeInTheDocument();
  });
});
