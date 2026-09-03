import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as authApi from "@/api/auth";
import { ApiError } from "@/api/client";
import * as authContext from "@/auth/AuthContext";
import { LoginPage } from "@/pages/LoginPage";

vi.mock("@/api/auth", () => ({ getLoginOptions: vi.fn() }));
const mockedGetLoginOptions = vi.mocked(authApi.getLoginOptions);

vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);

function mockAuth(overrides: Partial<ReturnType<typeof authContext.useAuth>> = {}) {
  mockedGetLoginOptions.mockResolvedValue({ password_login: true, otp_email_login: true });
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

/** Password is the default (audit H1); the code flow is one click away
 * once the server has said it can deliver. */
async function goToCodeFlow() {
  await userEvent.click(await screen.findByRole("button", { name: "Sign in with a code instead" }));
  expect(await screen.findByRole("button", { name: "Send login code" })).toBeInTheDocument();
}

describe("LoginPage", () => {
  it("defaults to password sign-in, not the email+code flow", () => {
    mockAuth();
    renderPage();

    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send login code" })).not.toBeInTheDocument();
  });

  it("offers the code flow only when the server says it can deliver", async () => {
    mockAuth();
    mockedGetLoginOptions.mockResolvedValue({ password_login: true, otp_email_login: false });
    renderPage();

    await waitFor(() => expect(mockedGetLoginOptions).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Sign in with a code instead" })).not.toBeInTheDocument();
  });

  it("never says a code was sent when the server refuses to send one", async () => {
    const requestOtp = vi.fn().mockRejectedValue(
      new ApiError(503, "Email login is currently unavailable. Please sign in with your password."),
    );
    mockAuth({ requestOtp });
    renderPage();
    await goToCodeFlow();

    await userEvent.type(screen.getByLabelText("Email"), "jane@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send login code" }));

    expect(await screen.findByText(/Email login is currently unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/login code has been sent/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Login code")).not.toBeInTheDocument();
  });

  it("requests a code, then shows the code-entry step", async () => {
    const requestOtp = vi.fn().mockResolvedValue(undefined);
    mockAuth({ requestOtp });
    renderPage();
    await goToCodeFlow();

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
    await goToCodeFlow();

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
    await goToCodeFlow();

    await userEvent.type(screen.getByLabelText("Email"), "jane@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send login code" }));
    await userEvent.type(await screen.findByLabelText("Login code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify & sign in" }));

    expect(await screen.findByText("Incorrect or expired code")).toBeInTheDocument();
  });

  it("signs in with a password from the default form", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    mockAuth({ login });
    renderPage();

    await userEvent.type(screen.getByLabelText("Email"), "jane@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "hunter2000");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(login).toHaveBeenCalledWith("jane@example.com", "hunter2000"));
    expect(await screen.findByText("dashboard page")).toBeInTheDocument();
  });

  it("can toggle the password field's visibility", async () => {
    mockAuth();
    renderPage();

    const passwordInput = screen.getByLabelText("Password");
    expect(passwordInput).toHaveAttribute("type", "password");

    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(passwordInput).toHaveAttribute("type", "text");

    await userEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(passwordInput).toHaveAttribute("type", "password");
  });

  it("resets the password field's visibility when switching away and back", async () => {
    mockAuth();
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");

    await goToCodeFlow();
    await userEvent.click(screen.getByRole("button", { name: "Sign in with a password instead" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("can switch to the code flow and back to password", async () => {
    mockAuth();
    renderPage();

    await goToCodeFlow();
    await userEvent.click(screen.getByRole("button", { name: "Sign in with a password instead" }));
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("redirects to the dashboard immediately if already authenticated", () => {
    mockAuth({ user: { id: "u-1" } as ReturnType<typeof authContext.useAuth>["user"] });
    renderPage();

    expect(screen.getByText("dashboard page")).toBeInTheDocument();
  });
});
