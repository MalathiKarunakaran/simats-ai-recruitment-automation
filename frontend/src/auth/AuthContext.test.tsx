import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "@/api/auth";
import { configureAuth } from "@/api/client";
import * as usersApi from "@/api/users";
import { AuthProvider, useAuth } from "@/auth/AuthContext";

vi.mock("@/api/auth");
// The provider loads the user's permission grants after login/restore. Left
// unmocked, that is a REAL fetch: with no backend listening it fails fast and
// is swallowed, but with a dev backend up on :8000 it returns 401, which
// triggers the silent-refresh-then-logout path and wipes the user mid-test.
vi.mock("@/api/users");
// Keep the real client module, but spy on configureAuth so tests can reach
// the refreshAccessToken hook AuthContext hands it.
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, configureAuth: vi.fn(actual.configureAuth) };
});

const mockedAuthApi = vi.mocked(authApi);
const mockedConfigureAuth = vi.mocked(configureAuth);

const TOKENS = { access_token: "at1", token_type: "bearer", must_change_password: false };

function TestConsumer() {
  const { user, isLoading, mustChangePassword, login, logout, completePasswordChange } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="user">{user ? user.email : "none"}</span>
      <span data-testid="must-change-password">{String(mustChangePassword)}</span>
      <button onClick={() => void login("hr.admin@example.com", "pw")}>login</button>
      <button onClick={() => void logout()}>logout</button>
      <button onClick={() => completePasswordChange({ ...FAKE_USER, must_change_password: false })}>
        complete password change
      </button>
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
  must_change_password: false,
  deactivation_protected: false,
  phone_number: null,
  last_login_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

/** Audit M1: the session must leave no trace in browser storage. */
function expectNoSessionInBrowserStorage() {
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
}

function renderProvider() {
  return render(
    <AuthProvider>
      <TestConsumer />
    </AuthProvider>,
  );
}

describe("AuthContext", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.mocked(usersApi.getUserPermissions).mockResolvedValue({ permissions: [] });
    // Default: no live session. The provider always asks the server once on
    // load, because the refresh token is an HttpOnly cookie script cannot see.
    mockedAuthApi.refresh.mockRejectedValue(new Error("no session"));
  });

  it("asks the server once on load and starts logged out when there is no session", async () => {
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(mockedAuthApi.refresh).toHaveBeenCalledTimes(1);
    expectNoSessionInBrowserStorage();
  });

  it("restores the session on load when the cookie refresh succeeds", async () => {
    mockedAuthApi.refresh.mockResolvedValue(TOKENS);
    mockedAuthApi.getMe.mockResolvedValue(FAKE_USER);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("hr.admin@example.com"));
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(mockedAuthApi.login).not.toHaveBeenCalled();
    expectNoSessionInBrowserStorage();
  });

  it("login populates the user and writes nothing to browser storage", async () => {
    mockedAuthApi.login.mockResolvedValue(TOKENS);
    mockedAuthApi.getMe.mockResolvedValue(FAKE_USER);

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    await userEvent.click(screen.getByText("login"));

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("hr.admin@example.com"));
    expectNoSessionInBrowserStorage();
    expect(localStorage.getItem("simats_refresh_token")).toBeNull();
  });

  it("login with must_change_password: true surfaces it on the context, and completePasswordChange clears it", async () => {
    mockedAuthApi.login.mockResolvedValue({ ...TOKENS, must_change_password: true });
    mockedAuthApi.getMe.mockResolvedValue(FAKE_USER);

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    await userEvent.click(screen.getByText("login"));

    await waitFor(() => expect(screen.getByTestId("must-change-password")).toHaveTextContent("true"));

    await userEvent.click(screen.getByText("complete password change"));

    await waitFor(() => expect(screen.getByTestId("must-change-password")).toHaveTextContent("false"));
  });

  it("logout calls the server (which revokes and clears the cookie) and drops the user", async () => {
    mockedAuthApi.login.mockResolvedValue(TOKENS);
    mockedAuthApi.getMe.mockResolvedValue(FAKE_USER);
    mockedAuthApi.logout.mockResolvedValue(undefined);

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    await userEvent.click(screen.getByText("login"));
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("hr.admin@example.com"));

    await userEvent.click(screen.getByText("logout"));

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("none"));
    expect(mockedAuthApi.logout).toHaveBeenCalledTimes(1);
    expect(mockedAuthApi.logout).toHaveBeenCalledWith();
    expectNoSessionInBrowserStorage();
  });

  it("a failed silent refresh on load leaves the user logged out, not stuck loading", async () => {
    mockedAuthApi.refresh.mockRejectedValue(new Error("expired"));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expectNoSessionInBrowserStorage();
  });

  it("concurrent refresh calls share one request, so a rotating cookie is never presented twice", async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    const bootstrapCalls = mockedAuthApi.refresh.mock.calls.length;

    let release!: (value: typeof TOKENS) => void;
    mockedAuthApi.refresh.mockImplementation(
      () =>
        new Promise<typeof TOKENS>((resolve) => {
          release = resolve;
        }),
    );
    const hooks = mockedConfigureAuth.mock.calls.at(-1)![0];

    const first = hooks.refreshAccessToken();
    const second = hooks.refreshAccessToken();
    release(TOKENS);

    await expect(Promise.all([first, second])).resolves.toEqual(["at1", "at1"]);
    expect(mockedAuthApi.refresh).toHaveBeenCalledTimes(bootstrapCalls + 1);
    expect(hooks.getAccessToken()).toBe("at1");
  });
});
