import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { UserRead } from "@/api/types";
import * as usersApi from "@/api/users";
import * as authContext from "@/auth/AuthContext";
import { SettingsPage } from "@/pages/SettingsPage";
import * as themeContext from "@/theme/ThemeContext";

vi.mock("@/api/users");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});
vi.mock("@/theme/ThemeContext", async () => {
  const actual = await vi.importActual<typeof import("@/theme/ThemeContext")>("@/theme/ThemeContext");
  return { ...actual, useTheme: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedUseTheme = vi.mocked(themeContext.useTheme);
const mockedGetOwnProfile = vi.mocked(usersApi.getOwnProfile);
const mockedUpdateOwnProfile = vi.mocked(usersApi.updateOwnProfile);

function mockUser(role: UserRead["role"], campusId: string | null = null) {
  mockedUseAuth.mockReturnValue({
    user: { id: "u-1", role, campus_id: campusId } as UserRead,
    isLoading: false,
    login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
    logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
  });
}

const PROFILE: UserRead = {
  id: "u-1",
  email: "jane@example.com",
  full_name: "Jane Doe",
  role: "SUPER_ADMIN",
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
  mockedUseTheme.mockReturnValue({ theme: "light", toggleTheme: vi.fn() });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Campus/Department create-edit CRUD moved out of SettingsPage into their
// own standalone pages (CampusesPage.test.tsx / DepartmentsPage.test.tsx),
// same as Designations always lived standalone -- SettingsPage is now
// scoped to just the personal profile + appearance toggle.
describe("SettingsPage", () => {
  it("loads and saves the personal profile form", async () => {
    mockUser("SUPER_ADMIN");
    mockedGetOwnProfile.mockResolvedValue(PROFILE);
    mockedUpdateOwnProfile.mockResolvedValue(PROFILE);

    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue("Jane Doe")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mockedUpdateOwnProfile).toHaveBeenCalledWith({ full_name: "Jane Doe", phone_number: null }),
    );
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("shows the current theme and toggles it", async () => {
    mockUser("RECRUITMENT_OFFICER", "c-sse");
    mockedGetOwnProfile.mockResolvedValue({ ...PROFILE, role: "RECRUITMENT_OFFICER" });
    const toggleTheme = vi.fn();
    mockedUseTheme.mockReturnValue({ theme: "light", toggleTheme });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText("Currently light mode")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Switch to dark" }));
    expect(toggleTheme).toHaveBeenCalled();
  });

  it("no longer shows Campus/Department management on this page for any role", async () => {
    mockUser("SUPER_ADMIN");
    mockedGetOwnProfile.mockResolvedValue(PROFILE);

    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue("Jane Doe")).toBeInTheDocument());
    expect(screen.queryByText("Organization")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New campus" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New department" })).not.toBeInTheDocument();
  });
});
