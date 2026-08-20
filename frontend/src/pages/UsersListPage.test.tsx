import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import type { CampusRead, UserRead } from "@/api/types";
import * as usersApi from "@/api/users";
import * as authContext from "@/auth/AuthContext";
import { UsersListPage } from "@/pages/UsersListPage";

vi.mock("@/api/users");
vi.mock("@/api/campuses");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListUsers = vi.mocked(usersApi.listUsers);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);

const CAMPUS: CampusRead = {
  id: "c-sse",
  code: "SSE",
  name: "Saveetha School of Engineering",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const JANE: UserRead = {
  id: "u-1",
  email: "jane@example.com",
  full_name: "Jane Doe",
  role: "HR_ADMIN",
  campus_id: "c-sse",
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <UsersListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("UsersListPage", () => {
  it("renders users with resolved campus code", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListUsers.mockResolvedValue([JANE]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("SSE")).toBeInTheDocument();
  });

  it("shows the empty-state message when no users exist", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListUsers.mockResolvedValue([]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText("No users found.")).toBeInTheDocument());
  });

  it("narrows the list with the search box", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListUsers.mockResolvedValue([
      JANE,
      { ...JANE, id: "u-2", full_name: "John Smith", email: "john@example.com" },
    ]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("John Smith")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText(/Search by name/), "jane");

    await waitFor(() => expect(screen.queryByText("John Smith")).not.toBeInTheDocument());
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
  });

  it("narrows the list with the role filter", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListUsers.mockResolvedValue([
      JANE,
      { ...JANE, id: "u-2", full_name: "John Smith", role: "CAMPUS_HOD" },
    ]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("John Smith")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Role filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "CAMPUS HOD" }));

    await waitFor(() => expect(screen.queryByText("Jane Doe")).not.toBeInTheDocument());
    expect(screen.getByText("John Smith")).toBeInTheDocument();
  });

  it("includes CANDIDATE in the role filter (a real seeded login account, not just staff roles)", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListUsers.mockResolvedValue([
      JANE,
      { ...JANE, id: "u-3", full_name: "Sample Candidate", role: "CANDIDATE" },
    ]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "Role filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "CANDIDATE" }));

    await waitFor(() => expect(screen.queryByText("Jane Doe")).not.toBeInTheDocument());
    expect(screen.getByText("Sample Candidate")).toBeInTheDocument();
  });

  it("narrows the list with the campus filter without re-fetching", async () => {
    const OTHER_CAMPUS: CampusRead = { ...CAMPUS, id: "c-scad", code: "SCAD" };
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListUsers.mockResolvedValue([
      JANE,
      { ...JANE, id: "u-2", full_name: "John Smith", campus_id: "c-scad" },
    ]);
    mockedListCampuses.mockResolvedValue([CAMPUS, OTHER_CAMPUS]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    const callCountBeforeFilter = mockedListUsers.mock.calls.length;

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SCAD" }));

    await waitFor(() => expect(screen.queryByText("Jane Doe")).not.toBeInTheDocument());
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    expect(mockedListUsers).toHaveBeenCalledTimes(callCountBeforeFilter);
  });

  it("narrows the list with the status filter", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListUsers.mockResolvedValue([
      JANE,
      { ...JANE, id: "u-2", full_name: "John Smith", is_active: false },
    ]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();
    // Status filter defaults to Active, so the inactive fixture is hidden
    // until the filter is switched -- matches this page's convention of
    // keeping deactivated accounts out of the default view.
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.queryByText("John Smith")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Status filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Inactive" }));

    await waitFor(() => expect(screen.queryByText("Jane Doe")).not.toBeInTheDocument());
    expect(screen.getByText("John Smith")).toBeInTheDocument();
  });

  it("distinguishes an empty scope from filters narrowing to zero", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListUsers.mockResolvedValue([JANE]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText(/Search by name/), "nobody");

    await waitFor(() => expect(screen.getByText("No users match these filters.")).toBeInTheDocument());
  });

  it("hides the New user button for a role that can't manage users", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListUsers.mockResolvedValue([JANE]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "New user" })).not.toBeInTheDocument();
  });
});
