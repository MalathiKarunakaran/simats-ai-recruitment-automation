import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "@/api/auth";
import { AuthProvider, useAuth } from "@/auth/AuthContext";

vi.mock("@/api/auth");

const mockedAuthApi = vi.mocked(authApi);

function TestConsumer() {
  const { user, isLoading, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="user">{user ? user.email : "none"}</span>
      <button onClick={() => void login("hr.admin@example.com", "pw")}>login</button>
      <button onClick={() => void logout()}>logout</button>
    </div>
  );
}

const FAKE_USER = {
  id: "u1",
  email: "hr.admin@example.com",
  full_name: "HR Admin",
  role: "HR_ADMIN" as const,
  campus_id: null,
  department_id: null,
  is_active: true,
  is_email_verified: true,
  phone_number: null,
  last_login_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("AuthContext", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("starts logged out (no stored refresh token) without surfacing an error", async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(mockedAuthApi.refresh).not.toHaveBeenCalled();
  });

  it("login populates the user and persists a refresh token", async () => {
    mockedAuthApi.login.mockResolvedValue({
      access_token: "at1",
      refresh_token: "rt1",
      token_type: "bearer",
    });
    mockedAuthApi.getMe.mockResolvedValue(FAKE_USER);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    await userEvent.click(screen.getByText("login"));

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("hr.admin@example.com"));
    expect(localStorage.getItem("simats_refresh_token")).toBe("rt1");
  });

  it("logout clears user state and the stored refresh token", async () => {
    mockedAuthApi.login.mockResolvedValue({ access_token: "at1", refresh_token: "rt1", token_type: "bearer" });
    mockedAuthApi.getMe.mockResolvedValue(FAKE_USER);
    mockedAuthApi.logout.mockResolvedValue(undefined);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    await userEvent.click(screen.getByText("login"));
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("hr.admin@example.com"));

    await userEvent.click(screen.getByText("logout"));

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("none"));
    expect(localStorage.getItem("simats_refresh_token")).toBeNull();
  });

  it("a failed silent refresh on load leaves the user logged out, not stuck loading", async () => {
    localStorage.setItem("simats_refresh_token", "stale-token");
    mockedAuthApi.refresh.mockRejectedValue(new Error("expired"));

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(localStorage.getItem("simats_refresh_token")).toBeNull();
  });
});
