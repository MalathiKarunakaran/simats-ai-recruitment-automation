import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { UserRead } from "@/api/types";
import * as usersApi from "@/api/users";
import * as authContext from "@/auth/AuthContext";
import { SetNewPasswordPage } from "@/pages/SetNewPasswordPage";

vi.mock("@/api/users");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUpdateOwnProfile = vi.mocked(usersApi.updateOwnProfile);
const mockedUseAuth = vi.mocked(authContext.useAuth);

const UPDATED_USER: UserRead = {
  id: "u-1",
  email: "jane@example.com",
  full_name: "Jane Doe",
  role: "HR_ADMIN",
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/set-new-password"]}>
      <Routes>
        <Route path="/set-new-password" element={<SetNewPasswordPage />} />
        <Route path="/dashboard" element={<div>dashboard page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SetNewPasswordPage", () => {
  it("submits the new password via the self-service endpoint and lands on the dashboard", async () => {
    const completePasswordChange = vi.fn();
    mockedUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login: vi.fn(),
      requestOtp: vi.fn(),
      loginWithOtp: vi.fn(),
      logout: vi.fn(),
      mustChangePassword: true,
      completePasswordChange,
    });
    mockedUpdateOwnProfile.mockResolvedValue(UPDATED_USER);

    renderPage();

    await userEvent.type(screen.getByLabelText("New password"), "newpass123");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "newpass123");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));

    await waitFor(() => expect(mockedUpdateOwnProfile).toHaveBeenCalledWith({ password: "newpass123" }));
    await waitFor(() => expect(completePasswordChange).toHaveBeenCalledWith(UPDATED_USER));
    expect(await screen.findByText("dashboard page")).toBeInTheDocument();
  });

  it("blocks submission for a password shorter than 8 characters", async () => {
    mockedUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login: vi.fn(),
      requestOtp: vi.fn(),
      loginWithOtp: vi.fn(),
      logout: vi.fn(),
      mustChangePassword: true,
      completePasswordChange: vi.fn(),
    });
    mockedUpdateOwnProfile.mockClear(); // a prior test in this file already confirmed a successful submit

    renderPage();

    await userEvent.type(screen.getByLabelText("New password"), "short1");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "short1");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));

    expect(await screen.findByText("Must be at least 8 characters")).toBeInTheDocument();
    expect(mockedUpdateOwnProfile).not.toHaveBeenCalled();
  });

  it("blocks submission when the two password fields don't match", async () => {
    mockedUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login: vi.fn(),
      requestOtp: vi.fn(),
      loginWithOtp: vi.fn(),
      logout: vi.fn(),
      mustChangePassword: true,
      completePasswordChange: vi.fn(),
    });
    mockedUpdateOwnProfile.mockClear(); // a prior test in this file already confirmed a successful submit

    renderPage();

    await userEvent.type(screen.getByLabelText("New password"), "newpass123");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "different123");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));

    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(mockedUpdateOwnProfile).not.toHaveBeenCalled();
  });
});
