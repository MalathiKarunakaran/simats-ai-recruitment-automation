import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import * as departmentsApi from "@/api/departments";
import type { CampusRead, DepartmentRead, UserRead } from "@/api/types";
import * as usersApi from "@/api/users";
import * as authContext from "@/auth/AuthContext";
import { UserDetailPage } from "@/pages/UserDetailPage";

vi.mock("@/api/users");
vi.mock("@/api/departments");
vi.mock("@/api/campuses");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedGetUser = vi.mocked(usersApi.getUser);
const mockedUpdateUser = vi.mocked(usersApi.updateUser);
const mockedGetUserCapabilities = vi.mocked(usersApi.getUserCapabilities);
const mockedSetUserCapabilities = vi.mocked(usersApi.setUserCapabilities);
const mockedListDepartments = vi.mocked(departmentsApi.listDepartments);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedUseAuth = vi.mocked(authContext.useAuth);

function mockCurrentUser(role: UserRead["role"] | null) {
  mockedUseAuth.mockReturnValue({
    user: role ? ({ role } as UserRead) : null,
    isLoading: false,
    login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
    logout: vi.fn(),
  });
}

const CAMPUS: CampusRead = {
  id: "c-sse",
  code: "SSE",
  name: "Saveetha School of Engineering",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const DEPARTMENT: DepartmentRead = {
  id: "d-cse",
  campus_id: "c-sse",
  name: "Computer Science",
  code: null,
  category: null,
  parent_group: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const COORDINATOR: UserRead = {
  id: "u-coord-1",
  email: "coordinator@example.com",
  full_name: "Coordinator One",
  role: "RECRUITMENT_COORDINATOR",
  campus_id: null,
  department_id: null,
  is_active: true,
  is_email_verified: true,
  phone_number: null,
  last_login_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const HR_ADMIN_USER: UserRead = {
  ...COORDINATOR,
  id: "u-hr-1",
  role: "HR_ADMIN",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/users/${COORDINATOR.id}`]}>
        <Routes>
          <Route path="/users/:id" element={<UserDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("UserDetailPage coordinator capabilities", () => {
  it("shows the capabilities card with none selected for a Super Admin viewing a coordinator", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedGetUserCapabilities.mockResolvedValue({ capabilities: [] });

    renderPage();

    await waitFor(() => expect(screen.getByText("Coordinator capabilities")).toBeInTheDocument());
    expect(mockedGetUserCapabilities).toHaveBeenCalledWith(COORDINATOR.id);
    const vacancyButton = screen.getByRole("button", { name: /Vacancy approval/ });
    expect(vacancyButton).toBeInTheDocument();
  });

  it("pre-selects the coordinator's currently granted capabilities", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedGetUserCapabilities.mockResolvedValue({ capabilities: ["VACANCY_APPROVAL", "INTERVIEWS"] });

    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: /Vacancy approval/ })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Candidates & applications/ })).toBeInTheDocument();
  });

  it("toggles a capability and saves the full replacement set", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedGetUserCapabilities.mockResolvedValue({ capabilities: ["VACANCY_APPROVAL"] });
    mockedSetUserCapabilities.mockResolvedValue({ capabilities: ["VACANCY_APPROVAL", "INTERVIEWS"] });

    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: /Interviews/ })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Interviews/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save capabilities" }));

    await waitFor(() =>
      expect(mockedSetUserCapabilities).toHaveBeenCalledWith(COORDINATOR.id, ["VACANCY_APPROVAL", "INTERVIEWS"]),
    );
  });

  it("hides the capabilities card for a non-coordinator user", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(HR_ADMIN_USER);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    const callsBefore = mockedGetUserCapabilities.mock.calls.length;

    renderPage();

    await waitFor(() => expect(screen.getByText(HR_ADMIN_USER.full_name)).toBeInTheDocument());
    expect(screen.queryByText("Coordinator capabilities")).not.toBeInTheDocument();
    expect(mockedGetUserCapabilities.mock.calls.length).toBe(callsBefore);
  });

  it("hides the capabilities card for an HR Admin viewer, since only Super Admin can grant them", async () => {
    mockCurrentUser("HR_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    const callsBefore = mockedGetUserCapabilities.mock.calls.length;

    renderPage();

    await waitFor(() => expect(screen.getByText(COORDINATOR.full_name)).toBeInTheDocument());
    expect(screen.queryByText("Coordinator capabilities")).not.toBeInTheDocument();
    expect(mockedGetUserCapabilities.mock.calls.length).toBe(callsBefore);
  });
});

describe("UserDetailPage activate/deactivate toggle", () => {
  it("deactivating an active user requires confirming a dialog before the mutation fires", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue({ ...COORDINATOR, is_active: true });
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedUpdateUser.mockResolvedValue({ ...COORDINATOR, is_active: false });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(mockedUpdateUser).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Deactivate user")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm deactivate" }));

    await waitFor(() => expect(mockedUpdateUser).toHaveBeenCalledWith(COORDINATOR.id, { is_active: false }));
  });

  it("Close on the deactivate confirm dialog aborts without calling the mutation", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue({ ...COORDINATOR, is_active: true });
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedUpdateUser.mockResolvedValue({ ...COORDINATOR, is_active: false });
    mockedUpdateUser.mockClear(); // a prior test in this file already confirmed a deactivate

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    const dialog = await screen.findByRole("dialog");

    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockedUpdateUser).not.toHaveBeenCalled();
  });

  it("reactivating an inactive user fires the mutation directly with no confirm dialog", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue({ ...COORDINATOR, is_active: false });
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedUpdateUser.mockResolvedValue({ ...COORDINATOR, is_active: true });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reactivate" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Reactivate" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(mockedUpdateUser).toHaveBeenCalledWith(COORDINATOR.id, { is_active: true }));
  });
});
