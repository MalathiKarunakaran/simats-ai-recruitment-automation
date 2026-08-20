import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as authContext from "@/auth/AuthContext";
import { LoginPage } from "@/pages/LoginPage";

vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);

function mockAuth(overrides: Partial<ReturnType<typeof authContext.useAuth>> = {}) {
  mockedUseAuth.mockReturnValue({
    user: null,
    isLoading: false,
    login: vi.fn(),
    requestOtp: vi.fn(),
    loginWithOtp: vi.fn(),
    logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    ...overrides,
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<div>dashboard page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LoginPage", () => {
  it("defaults to the email+code (OTP) flow, not password", () => {
    mockAuth();
    renderPage();

    expect(screen.getByRole("button", { name: "Send login code" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("requests a code, then shows the code-entry step", async () => {
    const requestOtp = vi.fn().mockResolvedValue(undefined);
    mockAuth({ requestOtp });
    renderPage();

    await userEvent.type(screen.getByLabelText("Email"), "jane@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send login code" }));

    await waitFor(() => expect(requestOtp).toHaveBeenCalledWith("jane@example.com"));
    expect(await screen.findByLabelText("Login code")).toBeInTheDocument();
  });

  it("verifies the code and lands on the dashboard", async () => {
    const requestOtp = vi.fn().mockResolvedValue(undefined);
    const loginWithOtp = vi.fn().mockResolvedValue(undefined);
    mockAuth({ requestOtp, loginWithOtp });
    renderPage();

    await userEvent.type(screen.getByLabelText("Email"), "jane@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send login code" }));
    await userEvent.type(await screen.findByLabelText("Login code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify & sign in" }));

    await waitFor(() => expect(loginWithOtp).toHaveBeenCalledWith("jane@example.com", "123456"));
    expect(await screen.findByText("dashboard page")).toBeInTheDocument();
  });

  it("shows an error for an incorrect or expired code", async () => {
    const requestOtp = vi.fn().mockResolvedValue(undefined);
    const loginWithOtp = vi.fn().mockRejectedValue(new Error("bad code"));
    mockAuth({ requestOtp, loginWithOtp });
    renderPage();

    await userEvent.type(screen.getByLabelText("Email"), "jane@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send login code" }));
    await userEvent.type(await screen.findByLabelText("Login code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify & sign in" }));

    expect(await screen.findByText("Incorrect or expired code")).toBeInTheDocument();
  });

  it("falls back to password login when chosen, and still works", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    mockAuth({ login });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Sign in with a password instead" }));
    await userEvent.type(screen.getByLabelText("Email"), "jane@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "hunter2000");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(login).toHaveBeenCalledWith("jane@example.com", "hunter2000"));
    expect(await screen.findByText("dashboard page")).toBeInTheDocument();
  });

  it("can switch back from password mode to the code flow", async () => {
    mockAuth();
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Sign in with a password instead" }));
    expect(screen.getByLabelText("Password")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Sign in with a code instead" }));
    expect(screen.getByRole("button", { name: "Send login code" })).toBeInTheDocument();
  });

  it("redirects to the dashboard immediately if already authenticated", () => {
    mockAuth({ user: { id: "u-1" } as ReturnType<typeof authContext.useAuth>["user"] });
    renderPage();

    expect(screen.getByText("dashboard page")).toBeInTheDocument();
  });
});
