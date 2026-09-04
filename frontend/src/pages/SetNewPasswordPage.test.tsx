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
    // saveOwnProfile (AuthContext) is what PATCHes and then re-establishes
    // the session -- a password change ends every session server-side.
    const saveOwnProfile = vi.fn().mockResolvedValue(UPDATED_USER);
    mockedUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login: vi.fn(),
      requestOtp: vi.fn(),
      loginWithOtp: vi.fn(),
      logout: vi.fn(),
      mustChangePassword: true,
      completePasswordChange,
      saveOwnProfile,
    });

    renderPage();

    await userEvent.type(screen.getByLabelText("New password"), "newpassword12");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "newpassword12");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));

    await waitFor(() => expect(saveOwnProfile).toHaveBeenCalledWith({ password: "newpassword12" }));
    expect(mockedUpdateOwnProfile).not.toHaveBeenCalled(); // never bypasses the session-aware path
    await waitFor(() => expect(completePasswordChange).toHaveBeenCalledWith(UPDATED_USER));
    expect(await screen.findByText("dashboard page")).toBeInTheDocument();
  });

  it("toggles each password field's visibility independently", async () => {
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

    renderPage();

    const newPasswordInput = screen.getByLabelText("New password");
    const confirmPasswordInput = screen.getByLabelText("Confirm new password");
    const [showNew, showConfirm] = screen.getAllByRole("button", { name: "Show password" });

    await userEvent.click(showNew);
    expect(newPasswordInput).toHaveAttribute("type", "text");
    expect(confirmPasswordInput).toHaveAttribute("type", "password");

    await userEvent.click(showConfirm);
    expect(confirmPasswordInput).toHaveAttribute("type", "text");
  });

  it("blocks submission for a password shorter than 12 characters", async () => {
    const saveOwnProfile = vi.fn();
    mockedUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login: vi.fn(),
      requestOtp: vi.fn(),
      loginWithOtp: vi.fn(),
      logout: vi.fn(),
      mustChangePassword: true,
      completePasswordChange: vi.fn(),
      saveOwnProfile,
    });

    renderPage();

    await userEvent.type(screen.getByLabelText("New password"), "elevenchars");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "elevenchars");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));

    expect(await screen.findByText("Must be at least 12 characters")).toBeInTheDocument();
    expect(saveOwnProfile).not.toHaveBeenCalled();
  });

  it("blocks submission when the two password fields don't match", async () => {
    const saveOwnProfile = vi.fn();
    mockedUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login: vi.fn(),
      requestOtp: vi.fn(),
      loginWithOtp: vi.fn(),
      logout: vi.fn(),
      mustChangePassword: true,
      completePasswordChange: vi.fn(),
      saveOwnProfile,
    });

    renderPage();

    await userEvent.type(screen.getByLabelText("New password"), "newpassword12");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "differentone12");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));

    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(saveOwnProfile).not.toHaveBeenCalled();
  });
});
