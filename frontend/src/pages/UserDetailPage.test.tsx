import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as auditLogsApi from "@/api/auditLogs";
import * as campusesApi from "@/api/campuses";
import { ApiError } from "@/api/client";
import * as departmentsApi from "@/api/departments";
import type { CampusRead, DepartmentRead, UserRead } from "@/api/types";
import * as usersApi from "@/api/users";
import * as authContext from "@/auth/AuthContext";
import { UserDetailPage } from "@/pages/UserDetailPage";

vi.mock("@/api/users");
vi.mock("@/api/departments");
vi.mock("@/api/campuses");
vi.mock("@/api/auditLogs");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedGetUser = vi.mocked(usersApi.getUser);
const mockedUpdateUser = vi.mocked(usersApi.updateUser);
const mockedDeleteUser = vi.mocked(usersApi.deleteUser);
const mockedForceLogoutUser = vi.mocked(usersApi.forceLogoutUser);
const mockedGetUserCapabilities = vi.mocked(usersApi.getUserCapabilities);
const mockedSetUserCapabilities = vi.mocked(usersApi.setUserCapabilities);
const mockedGetUserPermissions = vi.mocked(usersApi.getUserPermissions);
const mockedSetUserPermissions = vi.mocked(usersApi.setUserPermissions);
const mockedAdminResetPassword = vi.mocked(usersApi.adminResetPassword);
const mockedListDepartments = vi.mocked(departmentsApi.listDepartments);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedListAuditLogs = vi.mocked(auditLogsApi.listAuditLogs);
const mockedUseAuth = vi.mocked(authContext.useAuth);

// The current viewer's own id, distinct from every target user fixture below
// -- needed now that Recent Activity's visibility is derived from a
// self-read of GET /users/{currentUser.id}/permissions rather than a
// hardcoded role list.
const CURRENT_USER_ID = "u-current-viewer";

function mockCurrentUser(role: UserRead["role"] | null, id: string = CURRENT_USER_ID) {
  mockedUseAuth.mockReturnValue({
    user: role ? ({ role, id } as UserRead) : null,
    isLoading: false,
    login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
    logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
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
  description: null,
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
  must_change_password: false,
  deactivation_protected: false,
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

// Every viewer who can even reach this page is in USER_MANAGEMENT_ROLES
// (SUPER_ADMIN, HR_ADMIN). Default to an empty result so tests that don't
// care about Recent Activity don't need to mock it individually.
beforeEach(() => {
  mockedListAuditLogs.mockResolvedValue([]);
  // Recent Activity's visibility (for a non-SUPER_ADMIN viewer) and the
  // Permission Matrix card's data both come from GET .../permissions --
  // default to no grants so tests that don't care about either don't need to
  // mock this individually.
  mockedGetUserPermissions.mockResolvedValue({ permissions: [] });
});

function renderPage(targetId: string = COORDINATOR.id) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/users/${targetId}`]}>
        <Routes>
          <Route path="/users/:id" element={<UserDetailPage />} />
          <Route path="/users" element={<p>Users list</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openMoreActions() {
  await userEvent.click(await screen.findByRole("button", { name: "More actions" }));
}

// PermissionCategoryCards' summary strip splits "Enabled: N" across a parent
// <span> and a nested styled <span> for the number -- RTL's default string
// matcher only matches a single node's own textContent, so match on the
// full textContent of each node instead (see PermissionCategoryCards.test.tsx
// for the same helper).
function exactText(text: string) {
  return (_content: string, element: Element | null) => element?.textContent === text;
}

describe("UserDetailPage header and breadcrumb", () => {
  it("renders the Administration / Users / {name} breadcrumb trail with Users as a link", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    const nav = await screen.findByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).getByText("Administration")).toBeInTheDocument();
    const usersLink = within(nav).getByRole("link", { name: "Users" });
    expect(usersLink).toHaveAttribute("href", "/users");
    expect(within(nav).getByText(COORDINATOR.full_name)).toBeInTheDocument();
  });

  it("shows initials, role badge, and Active/Inactive badge in the compact header", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue({ ...COORDINATOR, is_active: false });
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    const heading = await screen.findByRole("heading", { level: 1, name: COORDINATOR.full_name });
    expect(screen.getByText("CO")).toBeInTheDocument();
    const badgeRow = heading.parentElement!;
    expect(within(badgeRow).getByText("RECRUITMENT COORDINATOR")).toBeInTheDocument();
    expect(within(badgeRow).getByText("Inactive")).toBeInTheDocument();
  });

  it("has a 'Back to Users' link back to the list", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    const link = await screen.findByRole("link", { name: "Back to Users" });
    expect(link).toHaveAttribute("href", "/users");
  });
});

describe("UserDetailPage access control -- save/cancel", () => {
  it("disables Save Changes until a field actually changes, then enables it", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();

    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByText("SUPER ADMIN"));

    expect(screen.getByRole("button", { name: "Save Changes" })).not.toBeDisabled();
  });

  it("Cancel resets the role field back to the loaded user's value and disables Save Changes again", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByText("SUPER ADMIN"));
    expect(screen.getByRole("button", { name: "Save Changes" })).not.toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
    expect(screen.getByRole("combobox")).toHaveTextContent("RECRUITMENT COORDINATOR");
  });

  it("saves the new role and shows an inline confirmation", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedUpdateUser.mockResolvedValue({ ...COORDINATOR, role: "SUPER_ADMIN" });

    renderPage();

    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByText("SUPER ADMIN"));
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(mockedUpdateUser).toHaveBeenCalledWith(COORDINATOR.id, {
        role: "SUPER_ADMIN",
        campus_id: null,
        department_id: null,
      }),
    );
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("shows 'All Campuses' and 'All Departments' as static text for a global-scope role instead of pickers", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR); // RECRUITMENT_COORDINATOR is global-scope
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByText("All Campuses")).toBeInTheDocument());
    expect(screen.getByText("All Departments")).toBeInTheDocument();
    // Only the Role select renders as a combobox -- no Campus/Department pickers.
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });
});

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

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: HR_ADMIN_USER.full_name })).toBeInTheDocument(),
    );
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

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: COORDINATOR.full_name })).toBeInTheDocument(),
    );
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
    mockedUpdateUser.mockClear(); // an earlier "save role" test in this file already confirmed a call

    renderPage();
    await openMoreActions();

    await userEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
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
    await openMoreActions();

    await userEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
    const dialog = await screen.findByRole("dialog");

    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockedUpdateUser).not.toHaveBeenCalled();
  });

  it("reactivating an inactive user requires confirming a dialog before the mutation fires", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue({ ...COORDINATOR, is_active: false });
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedUpdateUser.mockResolvedValue({ ...COORDINATOR, is_active: true });

    renderPage();
    await openMoreActions();

    await userEvent.click(await screen.findByRole("button", { name: "Activate" }));
    expect(mockedUpdateUser).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Reactivate user")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm reactivate" }));

    await waitFor(() => expect(mockedUpdateUser).toHaveBeenCalledWith(COORDINATOR.id, { is_active: true }));
  });

  it("disables Deactivate and shows an explanatory note for a protected active user", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue({ ...COORDINATOR, is_active: true, deactivation_protected: true });
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedUpdateUser.mockClear(); // prior tests in this file already confirmed calls

    renderPage();
    await openMoreActions();

    expect(await screen.findByRole("button", { name: "Deactivate" })).toBeDisabled();
    expect(screen.getByText("This account is protected from deactivation.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    // Radix's Popover content also carries role="dialog" -- since the click
    // above was a no-op on a disabled button, the More actions popover is
    // still open, so scope this check to the confirm dialog's own
    // accessible name rather than a bare role query.
    expect(screen.queryByRole("dialog", { name: "Deactivate user" })).not.toBeInTheDocument();
    expect(mockedUpdateUser).not.toHaveBeenCalled();
  });

  it("does not show the protected note or disable Deactivate for a non-protected user", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue({ ...COORDINATOR, is_active: true, deactivation_protected: false });
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();
    await openMoreActions();

    expect(await screen.findByRole("button", { name: "Deactivate" })).not.toBeDisabled();
    expect(screen.queryByText("This account is protected from deactivation.")).not.toBeInTheDocument();
  });

  it("degrades safely to 'not protected' when deactivation_protected is undefined on the fetched user", async () => {
    mockCurrentUser("SUPER_ADMIN");
    const { deactivation_protected: _omit, ...rest } = { ...COORDINATOR, is_active: true };
    mockedGetUser.mockResolvedValue(rest as UserRead);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();
    await openMoreActions();

    expect(await screen.findByRole("button", { name: "Deactivate" })).not.toBeDisabled();
    expect(screen.queryByText("This account is protected from deactivation.")).not.toBeInTheDocument();
  });

  it("reactivating an inactive protected user is still allowed -- deactivation_protected only blocks Deactivate", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue({ ...COORDINATOR, is_active: false, deactivation_protected: true });
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedUpdateUser.mockResolvedValue({ ...COORDINATOR, is_active: true, deactivation_protected: true });

    renderPage();
    await openMoreActions();

    const activateButton = await screen.findByRole("button", { name: "Activate" });
    expect(activateButton).not.toBeDisabled();
    await userEvent.click(activateButton);

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm reactivate" }));

    await waitFor(() => expect(mockedUpdateUser).toHaveBeenCalledWith(COORDINATOR.id, { is_active: true }));
  });

  it("surfaces the server's protected-account 400 error inline in the dialog without closing it", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue({ ...COORDINATOR, is_active: true, deactivation_protected: false });
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedUpdateUser.mockRejectedValue(new ApiError(400, "This account is protected from deactivation."));

    renderPage();
    await openMoreActions();

    await userEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm deactivate" }));

    await waitFor(() => expect(mockedUpdateUser).toHaveBeenCalledWith(COORDINATOR.id, { is_active: false }));
    expect(await within(dialog).findByText("This account is protected from deactivation.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("UserDetailPage delete", () => {
  it("shows Delete in More actions for a Super Admin viewing a non-protected, non-Super-Admin user", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue({ ...COORDINATOR, deactivation_protected: false });
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();
    await openMoreActions();

    expect(await screen.findByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("hides Delete for an HR Admin viewer -- SUPER_ADMIN only", async () => {
    mockCurrentUser("HR_ADMIN");
    mockedGetUser.mockResolvedValue({ ...COORDINATOR, deactivation_protected: false });
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();
    await openMoreActions();

    await waitFor(() => expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("hides Delete for a Super Admin target -- Super Admin accounts can't be deleted", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue({ ...COORDINATOR, role: "SUPER_ADMIN", deactivation_protected: false });
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();
    await openMoreActions();

    await waitFor(() => expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("hides Delete for a protected target", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue({ ...COORDINATOR, deactivation_protected: true });
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();
    await openMoreActions();

    await waitFor(() => expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("confirms and calls deleteUser, then navigates back to the users list", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue({ ...COORDINATOR, deactivation_protected: false });
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedDeleteUser.mockResolvedValue(undefined);

    renderPage();
    await openMoreActions();
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete user")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(mockedDeleteUser).toHaveBeenCalledWith(COORDINATOR.id));
    await waitFor(() => expect(screen.getByText("Users list")).toBeInTheDocument());
  });

  it("surfaces a 409 conflict error inline in the dialog without closing it", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue({ ...COORDINATOR, deactivation_protected: false });
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedDeleteUser.mockRejectedValue(
      new ApiError(
        409,
        "This user has related recruitment, interview, or audit history and cannot be deleted. Deactivate the account instead.",
      ),
    );

    renderPage();
    await openMoreActions();
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(mockedDeleteUser).toHaveBeenCalled());
    expect(
      await within(dialog).findByText(
        "This user has related recruitment, interview, or audit history and cannot be deleted. Deactivate the account instead.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("UserDetailPage force logout", () => {
  it("shows the Force logout action for a Super Admin viewer", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: "Force logout" })).toBeInTheDocument());
  });

  it("shows the Force logout action for an HR Admin viewer too -- USER_MANAGEMENT_ROLES", async () => {
    mockCurrentUser("HR_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: "Force logout" })).toBeInTheDocument());
  });

  it("confirms and calls forceLogoutUser, showing an inline success message", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedForceLogoutUser.mockResolvedValue(undefined);

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Force logout" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Force logout" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Sign out all sessions")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm sign out" }));

    await waitFor(() => expect(mockedForceLogoutUser).toHaveBeenCalledWith(COORDINATOR.id));
    expect(await within(dialog).findByText("All sessions ended.")).toBeInTheDocument();
  });

  it("surfaces an error inline in the dialog on failure", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedForceLogoutUser.mockRejectedValue(new ApiError(404, "Not found"));

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Force logout" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Force logout" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm sign out" }));

    expect(await within(dialog).findByText("Not found")).toBeInTheDocument();
  });
});

describe("UserDetailPage recent activity", () => {
  it("fetches a larger page of audit log entries for this actor and renders friendly labels", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedListAuditLogs.mockResolvedValue([
      {
        id: "log-1",
        actor_user_id: COORDINATOR.id,
        actor_role_snapshot: "RECRUITMENT_COORDINATOR",
        campus_context_id: null,
        action: "LOGIN_SUCCESS",
        entity_type: null,
        entity_id: null,
        before_state: null,
        after_state: null,
        http_method: null,
        http_path: null,
        status_code: null,
        ip_address: null,
        user_agent: null,
        created_at: "2026-08-19T10:00:00Z",
      },
      {
        id: "log-2",
        actor_user_id: COORDINATOR.id,
        actor_role_snapshot: "RECRUITMENT_COORDINATOR",
        campus_context_id: null,
        action: "UPDATE",
        entity_type: "VacancyRequest",
        entity_id: "vr-1",
        before_state: null,
        after_state: null,
        http_method: null,
        http_path: null,
        status_code: null,
        ip_address: null,
        user_agent: null,
        created_at: "2026-08-18T10:00:00Z",
      },
    ]);

    renderPage();

    await waitFor(() => expect(mockedListAuditLogs).toHaveBeenCalledWith({ actorUserId: COORDINATOR.id, limit: 20 }));
    expect(await screen.findByText("Logged in")).toBeInTheDocument();
    expect(screen.getByText("Vacancy request updated")).toBeInTheDocument();
  });

  it("filters out TOKEN_REFRESHED entries so they never crowd out real activity", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    const baseEntry = {
      actor_user_id: COORDINATOR.id,
      actor_role_snapshot: "RECRUITMENT_COORDINATOR",
      campus_context_id: null,
      entity_type: null,
      entity_id: null,
      before_state: null,
      after_state: null,
      http_method: null,
      http_path: null,
      status_code: null,
      ip_address: null,
      user_agent: null,
    };
    mockedListAuditLogs.mockResolvedValue([
      { ...baseEntry, id: "log-a", action: "TOKEN_REFRESHED", created_at: "2026-08-19T12:00:00Z" },
      { ...baseEntry, id: "log-b", action: "LOGIN_SUCCESS", created_at: "2026-08-19T11:00:00Z" },
      { ...baseEntry, id: "log-c", action: "TOKEN_REFRESHED", created_at: "2026-08-19T10:00:00Z" },
      { ...baseEntry, id: "log-d", action: "LOGOUT", created_at: "2026-08-19T09:00:00Z" },
    ]);

    renderPage();

    expect(await screen.findByText("Logged in")).toBeInTheDocument();
    expect(screen.getByText("Logged out")).toBeInTheDocument();
    expect(screen.queryByText(/TOKEN_REFRESHED/)).not.toBeInTheDocument();
  });

  it("falls back to a generic 'action entity' label for an unmapped action/entity_type combination", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedListAuditLogs.mockResolvedValue([
      {
        id: "log-3",
        actor_user_id: COORDINATOR.id,
        actor_role_snapshot: "RECRUITMENT_COORDINATOR",
        campus_context_id: null,
        action: "PUBLISH",
        entity_type: "JobPosting",
        entity_id: "jp-1",
        before_state: null,
        after_state: null,
        http_method: null,
        http_path: null,
        status_code: null,
        ip_address: null,
        user_agent: null,
        created_at: "2026-08-17T10:00:00Z",
      },
    ]);

    renderPage();

    expect(await screen.findByText("PUBLISH JobPosting")).toBeInTheDocument();
  });

  it("shows a 'View Activity Log' link to the shared activity log page", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    const link = await screen.findByRole("link", { name: "View Activity Log" });
    expect(link).toHaveAttribute("href", "/activity-log");
  });

  it("shows an empty state when there is no recorded activity", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedListAuditLogs.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("No recent activity for this user.")).toBeInTheDocument();
  });
});

describe("UserDetailPage recent activity visibility -- dynamic ACTIVITY_LOG permission", () => {
  it("shows Recent Activity for a non-Super-Admin viewer who has been granted ACTIVITY_LOG", async () => {
    mockCurrentUser("HR_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedGetUserPermissions.mockImplementation(async (id) =>
      id === CURRENT_USER_ID ? { permissions: ["ACTIVITY_LOG"] } : { permissions: [] },
    );

    renderPage();

    await waitFor(() => expect(mockedGetUserPermissions).toHaveBeenCalledWith(CURRENT_USER_ID));
    expect(await screen.findByText("Recent Activity")).toBeInTheDocument();
  });

  it("hides Recent Activity for a non-Super-Admin viewer without ACTIVITY_LOG granted", async () => {
    mockCurrentUser("HR_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedGetUserPermissions.mockResolvedValue({ permissions: [] });

    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: COORDINATOR.full_name })).toBeInTheDocument(),
    );
    expect(screen.queryByText("Recent Activity")).not.toBeInTheDocument();
  });

  it("always shows Recent Activity for a Super Admin viewer regardless of their own grant rows -- implicit bypass", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    // SUPER_ADMIN never has UserPermissionGrant rows of its own on the
    // backend -- confirm the frontend doesn't rely on this call returning
    // ACTIVITY_LOG to show the section.
    mockedGetUserPermissions.mockResolvedValue({ permissions: [] });

    renderPage();

    expect(await screen.findByText("Recent Activity")).toBeInTheDocument();
  });
});

describe("UserDetailPage permission matrix", () => {
  it("renders the Permission Matrix card as compact category cards for a Super Admin viewer", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(HR_ADMIN_USER);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedGetUserPermissions.mockResolvedValue({ permissions: [] });

    renderPage(HR_ADMIN_USER.id);

    expect(await screen.findByText("Permission Matrix")).toBeInTheDocument();
    expect(mockedGetUserPermissions).toHaveBeenCalledWith(HR_ADMIN_USER.id);
    // Category grouping/labels and the drawer-toggle mechanics themselves
    // are covered in PermissionCategoryCards.test.tsx -- this integration
    // test only confirms the new component is actually wired up here.
    const region = screen.getByRole("region", { name: "Permission categories" });
    expect(within(region).getByText("Vacancy Management")).toBeInTheDocument();
    expect(within(region).getByText("Candidates & Applications")).toBeInTheDocument();
    expect(within(region).getAllByRole("button", { name: "Manage Permissions" })).toHaveLength(6);
  });

  it("pre-selects the target's currently granted permissions as pills on the relevant category cards", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(HR_ADMIN_USER);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedGetUserPermissions.mockResolvedValue({ permissions: ["VIEW_VACANCY", "MANAGE_USERS"] });

    renderPage(HR_ADMIN_USER.id);

    expect(await screen.findByText("View vacancies")).toBeInTheDocument();
    expect(screen.getByText("Manage users")).toBeInTheDocument();
    expect(screen.getByText(exactText("Enabled: 2"))).toBeInTheDocument();
  });

  it("toggles a permission in a category drawer and saves the full replacement set via the real mutation", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(HR_ADMIN_USER);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedGetUserPermissions.mockResolvedValue({ permissions: ["VIEW_VACANCY"] });
    mockedSetUserPermissions.mockResolvedValue({ permissions: ["VIEW_VACANCY", "MANAGE_USERS"] });

    renderPage(HR_ADMIN_USER.id);

    const region = await screen.findByRole("region", { name: "Permission categories" });
    const adminCard = within(region).getByText("Administration").closest(".rounded-xl") as HTMLElement;
    await userEvent.click(within(adminCard).getByRole("button", { name: "Manage Permissions" }));
    await userEvent.click(screen.getByRole("switch", { name: "Manage users" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockedSetUserPermissions).toHaveBeenCalledWith(HR_ADMIN_USER.id, ["VIEW_VACANCY", "MANAGE_USERS"]),
    );
    // Drawer closes on success, and the top summary strip is reactive --
    // not frozen at the value it had on initial load.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText(exactText("Enabled: 2"))).toBeInTheDocument();
  });

  it("Cancel in a category drawer never calls setUserPermissions -- a true no-op", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(HR_ADMIN_USER);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedGetUserPermissions.mockResolvedValue({ permissions: ["VIEW_VACANCY"] });
    mockedSetUserPermissions.mockClear();

    renderPage(HR_ADMIN_USER.id);

    const region = await screen.findByRole("region", { name: "Permission categories" });
    const adminCard = within(region).getByText("Administration").closest(".rounded-xl") as HTMLElement;
    await userEvent.click(within(adminCard).getByRole("button", { name: "Manage Permissions" }));
    await userEvent.click(screen.getByRole("switch", { name: "Manage users" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedSetUserPermissions).not.toHaveBeenCalled();
    expect(screen.getByText(exactText("Enabled: 1"))).toBeInTheDocument();
  });

  it("hides the Permission Matrix card for a Super Admin target", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue({ ...HR_ADMIN_USER, role: "SUPER_ADMIN" });
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    // `mockedGetUserPermissions`'s call history isn't reset between tests in
    // this file, and the current viewer's own permission self-check (for
    // Recent Activity's dynamic visibility) fires regardless of the target's
    // role -- so count calls scoped to *this specific target id* rather than
    // the mock's total call count, which other tests may have already bumped.
    const targetCallsBefore = mockedGetUserPermissions.mock.calls.filter(
      ([calledId]) => calledId === HR_ADMIN_USER.id,
    ).length;

    renderPage(HR_ADMIN_USER.id);

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: HR_ADMIN_USER.full_name })).toBeInTheDocument(),
    );
    expect(screen.queryByText("Permission Matrix")).not.toBeInTheDocument();
    const targetCallsAfter = mockedGetUserPermissions.mock.calls.filter(
      ([calledId]) => calledId === HR_ADMIN_USER.id,
    ).length;
    expect(targetCallsAfter).toBe(targetCallsBefore);
  });

  it("hides the Permission Matrix card for a Candidate target", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue({ ...HR_ADMIN_USER, role: "CANDIDATE" });
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage(HR_ADMIN_USER.id);

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: HR_ADMIN_USER.full_name })).toBeInTheDocument(),
    );
    expect(screen.queryByText("Permission Matrix")).not.toBeInTheDocument();
  });

  it("hides the Permission Matrix card for an HR Admin viewer -- Super Admin only", async () => {
    mockCurrentUser("HR_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: COORDINATOR.full_name })).toBeInTheDocument(),
    );
    expect(screen.queryByText("Permission Matrix")).not.toBeInTheDocument();
  });

  it("still shows the existing Coordinator capabilities card alongside the new Permission Matrix card for a coordinator target", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedGetUserCapabilities.mockResolvedValue({ capabilities: [] });
    mockedGetUserPermissions.mockResolvedValue({ permissions: [] });

    renderPage();

    expect(await screen.findByText("Coordinator capabilities")).toBeInTheDocument();
    expect(await screen.findByText("Permission Matrix")).toBeInTheDocument();
  });
});

describe("UserDetailPage security status", () => {
  it("shows the 'Must change password' badge when the target has must_change_password set", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue({ ...COORDINATOR, must_change_password: true });
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    expect(await screen.findByText("Must change password")).toBeInTheDocument();
  });

  it("shows a 'Password set' badge when must_change_password is false", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue({ ...COORDINATOR, must_change_password: false });
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    expect(await screen.findByText("Password set")).toBeInTheDocument();
  });
});

describe("UserDetailPage reset password", () => {
  it("shows the Reset password action for a Super Admin viewer", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: "Reset password" })).toBeInTheDocument());
  });

  it("hides the Reset password action for an HR Admin viewer -- narrower than USER_MANAGEMENT_ROLES, SUPER_ADMIN only", async () => {
    mockCurrentUser("HR_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: COORDINATOR.full_name })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Reset password" })).not.toBeInTheDocument();
  });

  it("submits the new password and shows a success message without displaying the password", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedAdminResetPassword.mockResolvedValue({ ...COORDINATOR, must_change_password: true });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset password" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("New password"), "newpass123");
    await userEvent.type(within(dialog).getByLabelText("Confirm password"), "newpass123");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reset password" }));

    await waitFor(() => expect(mockedAdminResetPassword).toHaveBeenCalledWith(COORDINATOR.id, "newpass123"));
    expect(
      await within(dialog).findByText("Password reset. This user must set a new password on next login."),
    ).toBeInTheDocument();
    expect(screen.queryByText("newpass123")).not.toBeInTheDocument();
  });

  it("toggles the reset-password dialog's two password fields independently", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset password" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));

    const dialog = await screen.findByRole("dialog");
    const newPasswordInput = within(dialog).getByLabelText("New password");
    const confirmPasswordInput = within(dialog).getByLabelText("Confirm password");
    const [showNew, showConfirm] = within(dialog).getAllByRole("button", { name: "Show password" });

    await userEvent.click(showNew);
    expect(newPasswordInput).toHaveAttribute("type", "text");
    expect(confirmPasswordInput).toHaveAttribute("type", "password");

    await userEvent.click(showConfirm);
    expect(confirmPasswordInput).toHaveAttribute("type", "text");
  });

  it("blocks submission and never calls the API for a password shorter than 8 characters", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedAdminResetPassword.mockClear(); // a prior test in this file already confirmed a successful reset call

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset password" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("New password"), "short1");
    await userEvent.type(within(dialog).getByLabelText("Confirm password"), "short1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reset password" }));

    expect(await within(dialog).findByText("Must be at least 8 characters")).toBeInTheDocument();
    expect(mockedAdminResetPassword).not.toHaveBeenCalled();
  });

  it("blocks submission when the two password fields don't match", async () => {
    mockCurrentUser("SUPER_ADMIN");
    mockedGetUser.mockResolvedValue(COORDINATOR);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedAdminResetPassword.mockClear(); // a prior test in this file already confirmed a successful reset call

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset password" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("New password"), "newpass123");
    await userEvent.type(within(dialog).getByLabelText("Confirm password"), "different123");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reset password" }));

    expect(await within(dialog).findByText("Passwords do not match")).toBeInTheDocument();
    expect(mockedAdminResetPassword).not.toHaveBeenCalled();
  });
});
