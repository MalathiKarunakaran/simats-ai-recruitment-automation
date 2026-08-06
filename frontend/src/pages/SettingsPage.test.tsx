import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import * as departmentsApi from "@/api/departments";
import type { CampusRead, DepartmentRead, UserRead } from "@/api/types";
import * as usersApi from "@/api/users";
import * as authContext from "@/auth/AuthContext";
import { SettingsPage } from "@/pages/SettingsPage";
import * as themeContext from "@/theme/ThemeContext";

vi.mock("@/api/users");
vi.mock("@/api/campuses");
vi.mock("@/api/departments");
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
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedListDepartments = vi.mocked(departmentsApi.listDepartments);
const mockedCreateCampus = vi.mocked(campusesApi.createCampus);
const mockedUpdateCampus = vi.mocked(campusesApi.updateCampus);
const mockedCreateDepartment = vi.mocked(departmentsApi.createDepartment);

function mockUser(role: UserRead["role"], campusId: string | null = null) {
  mockedUseAuth.mockReturnValue({
    user: { id: "u-1", role, campus_id: campusId } as UserRead,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
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
  phone_number: null,
  last_login_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const SSE: CampusRead = {
  id: "c-sse",
  code: "SSE",
  name: "Saveetha School of Engineering",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// SHIFT added 2026-08-06 as a real 8th institutional campus code (confirmed
// by the user -- was previously an unresolved "8 campuses, only 7 named" gap,
// see CLAUDE.md's "Source spec" section).
const ALL_EIGHT_CAMPUSES: CampusRead[] = [
  "SSE",
  "SCLAS",
  "SCAD",
  "STUDIO",
  "SPIER",
  "SHOTS",
  "SSPE",
  "SHIFT",
].map((code) => ({ ...SSE, id: `c-${code}`, code: code as CampusRead["code"] }));

const DEPARTMENT: DepartmentRead = {
  id: "d-1",
  campus_id: "c-sse",
  name: "Computer Science",
  code: null,
  category: null,
  parent_group: null,
  is_active: true,
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

describe("SettingsPage", () => {
  it("loads and saves the personal profile form", async () => {
    mockUser("SUPER_ADMIN");
    mockedGetOwnProfile.mockResolvedValue(PROFILE);
    mockedUpdateOwnProfile.mockResolvedValue(PROFILE);
    mockedListCampuses.mockResolvedValue(ALL_EIGHT_CAMPUSES);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue("Jane Doe")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mockedUpdateOwnProfile).toHaveBeenCalledWith({ full_name: "Jane Doe", phone_number: null }),
    );
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("hides the Organization section entirely for a role with neither permission", async () => {
    mockUser("RECRUITMENT_OFFICER", "c-sse");
    mockedGetOwnProfile.mockResolvedValue({ ...PROFILE, role: "RECRUITMENT_OFFICER" });
    mockedListCampuses.mockResolvedValue(ALL_EIGHT_CAMPUSES);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue("Jane Doe")).toBeInTheDocument());
    expect(screen.queryByText("Organization")).not.toBeInTheDocument();
    expect(screen.queryByText("Campuses")).not.toBeInTheDocument();
    expect(screen.queryByText("Departments")).not.toBeInTheDocument();
  });

  it("shows only Departments (not Campuses) for HR Admin", async () => {
    mockUser("HR_ADMIN");
    mockedGetOwnProfile.mockResolvedValue({ ...PROFILE, role: "HR_ADMIN" });
    mockedListCampuses.mockResolvedValue(ALL_EIGHT_CAMPUSES);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Departments")).toBeInTheDocument());
    expect(screen.queryByText("Campuses")).not.toBeInTheDocument();
  });

  it("shows both Campuses and Departments for Super Admin", async () => {
    mockUser("SUPER_ADMIN");
    mockedGetOwnProfile.mockResolvedValue(PROFILE);
    mockedListCampuses.mockResolvedValue(ALL_EIGHT_CAMPUSES);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Campuses")).toBeInTheDocument());
    expect(screen.getByText("Departments")).toBeInTheDocument();
  });

  it("disables New campus once all 8 institutional codes are already in use", async () => {
    mockUser("SUPER_ADMIN");
    mockedGetOwnProfile.mockResolvedValue(PROFILE);
    mockedListCampuses.mockResolvedValue(ALL_EIGHT_CAMPUSES);
    mockedListDepartments.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText("SSE")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "New campus" })).toBeDisabled();
  });

  it("creates a new campus from an available code", async () => {
    mockUser("SUPER_ADMIN");
    mockedGetOwnProfile.mockResolvedValue(PROFILE);
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([]);
    mockedCreateCampus.mockResolvedValue({ ...SSE, id: "c-scad", code: "SCAD" });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "New campus" })).toBeEnabled());

    await userEvent.click(screen.getByRole("button", { name: "New campus" }));
    // Two comboboxes in the dialog: the institutional code Select, then Active.
    await userEvent.click(screen.getAllByRole("combobox")[0]);
    await userEvent.click(await screen.findByRole("option", { name: "SCAD" }));
    await userEvent.type(screen.getByLabelText("Name"), "SCAD Campus");
    await userEvent.click(screen.getByRole("button", { name: "Create campus" }));

    await waitFor(() =>
      expect(mockedCreateCampus).toHaveBeenCalledWith({ code: "SCAD", name: "SCAD Campus", is_active: true }),
    );
  });

  it("edits an existing campus's name without changing its code", async () => {
    mockUser("SUPER_ADMIN");
    mockedGetOwnProfile.mockResolvedValue(PROFILE);
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([]);
    mockedUpdateCampus.mockResolvedValue({ ...SSE, name: "Saveetha School of Engineering (updated)" });

    renderPage();
    await waitFor(() => expect(screen.getByText("SSE")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const nameInput = screen.getByLabelText("Name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Saveetha School of Engineering (updated)");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mockedUpdateCampus).toHaveBeenCalledWith("c-sse", {
        name: "Saveetha School of Engineering (updated)",
        is_active: true,
      }),
    );
  });

  it("hides the Organization section entirely for a Campus HOD (write access removed with the Designation Master rollout)", async () => {
    mockUser("CAMPUS_HOD", "c-sse");
    mockedGetOwnProfile.mockResolvedValue({ ...PROFILE, role: "CAMPUS_HOD", campus_id: "c-sse" });
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);

    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue("Jane Doe")).toBeInTheDocument());
    expect(screen.queryByText("Organization")).not.toBeInTheDocument();
    expect(screen.queryByText("Departments")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New department" })).not.toBeInTheDocument();
  });

  it("creates a department with the new code/category/parent_group master-data fields for an HR Admin", async () => {
    mockUser("HR_ADMIN");
    mockedGetOwnProfile.mockResolvedValue({ ...PROFILE, role: "HR_ADMIN" });
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedCreateDepartment.mockResolvedValue({ ...DEPARTMENT, id: "d-2", name: "Physics" });

    renderPage();
    await waitFor(() => expect(screen.getByText("Departments")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New department" }));
    await userEvent.click(screen.getAllByRole("combobox")[0]);
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));
    await userEvent.type(screen.getByLabelText("Name"), "Physics");
    await userEvent.click(screen.getByRole("button", { name: "Create department" }));

    await waitFor(() =>
      expect(mockedCreateDepartment).toHaveBeenCalledWith({
        campus_id: "c-sse",
        name: "Physics",
        code: null,
        category: null,
        parent_group: null,
        is_active: true,
      }),
    );
  });
});
