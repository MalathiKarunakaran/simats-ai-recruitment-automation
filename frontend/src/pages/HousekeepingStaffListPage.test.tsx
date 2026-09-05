import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import * as designationsApi from "@/api/designations";
import * as housekeepingStaffApi from "@/api/housekeepingStaff";
import * as locationsApi from "@/api/locations";
import * as sanctionedStrengthApi from "@/api/sanctionedStrength";
import type { CampusRead, DesignationRead, HousekeepingStaffRead, LocationRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { HousekeepingStaffListPage } from "@/pages/HousekeepingStaffListPage";

vi.mock("@/api/campuses");
vi.mock("@/api/designations");
vi.mock("@/api/locations");
vi.mock("@/api/housekeepingStaff");
// Phase J (glowing-zooming-hamming.md) -- HousekeepingStaffBulkUploadDialog/
// the Upload history dialog both pull from this module too (the shared
// error-report download and the shared bulk-uploads list respectively).
vi.mock("@/api/sanctionedStrength");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedListDesignations = vi.mocked(designationsApi.listDesignations);
const mockedListLocations = vi.mocked(locationsApi.listLocations);
const mockedListHousekeepingStaff = vi.mocked(housekeepingStaffApi.listHousekeepingStaff);
const mockedDeleteHousekeepingStaff = vi.mocked(housekeepingStaffApi.deleteHousekeepingStaff);
const mockedListBulkUploads = vi.mocked(sanctionedStrengthApi.listSanctionedStrengthBulkUploads);

function mockUser(role: UserRead["role"], campusId: string | null = null) {
  mockedUseAuth.mockReturnValue({
    user: { id: "u-1", role, campus_id: campusId } as UserRead,
    isLoading: false,
    login: vi.fn(),
    requestOtp: vi.fn(),
    loginWithOtp: vi.fn(),
    logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
  });
}

const SSE: CampusRead = {
  id: "c-sse",
  code: "SSE",
  name: "Saveetha School of Engineering",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
const SCLAS: CampusRead = { ...SSE, id: "c-sclas", code: "SCLAS" };

const HK_DESIGNATION: DesignationRead = {
  id: "d-hk-1",
  name: "Housekeeping Supervisor",
  category: "HOUSEKEEPING",
  qualification: "10th pass",
  min_experience: "1 year",
  employment_type: "FULL_TIME",
  required_skills: null,
  is_active: true,
  department_ids: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const SSE_LOCATION: LocationRead = {
  id: "l-sse-1",
  campus_id: "c-sse",
  name: "Central Library",
  block_building: "Block A",
  floor_venue: "Ground Floor",
  category: "HOUSEKEEPING",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const KAMALA: HousekeepingStaffRead = {
  id: "hk-1",
  campus_id: "c-sse",
  employee_id: null,
  bio_id: "BIO-001",
  name: "Kamala Devi",
  designation_id: "d-hk-1",
  location_id: "l-sse-1",
  block: "Block A",
  floor_venue: "Ground Floor",
  shift: "MORNING",
  supervisor: "Ramesh",
  is_active: true,
  created_by_id: "u-1",
  updated_by_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
const INACTIVE_STAFF: HousekeepingStaffRead = {
  ...KAMALA,
  id: "hk-2",
  bio_id: "BIO-002",
  name: "Suresh Kumar",
  is_active: false,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HousekeepingStaffListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockCommonLists() {
  mockedListCampuses.mockResolvedValue([SSE, SCLAS]);
  mockedListDesignations.mockResolvedValue([HK_DESIGNATION]);
  mockedListLocations.mockResolvedValue([SSE_LOCATION]);
}

describe("HousekeepingStaffListPage", () => {
  it("lists housekeeping staff with name, bio_id, designation, location, block, shift, supervisor, status", async () => {
    mockUser("HR_ADMIN");
    mockCommonLists();
    mockedListHousekeepingStaff.mockResolvedValue([KAMALA]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Kamala Devi")).toBeInTheDocument());
    expect(screen.getByText("BIO-001")).toBeInTheDocument();
    expect(screen.getByText("Housekeeping Supervisor")).toBeInTheDocument();
    // The Location column now reads "<block> — <floor>"; the bare
    // "Block A" assertion below is the STAFF row's own block column.
    expect(screen.getByText("Block A — Ground Floor")).toBeInTheDocument();
    expect(screen.getByText("Block A")).toBeInTheDocument();
    expect(screen.getByText("Morning")).toBeInTheDocument();
    expect(screen.getByText("Ramesh")).toBeInTheDocument();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
  });

  it("hides inactive staff by default, reachable via the Active filter", async () => {
    mockUser("HR_ADMIN");
    mockCommonLists();
    mockedListHousekeepingStaff.mockResolvedValue([KAMALA, INACTIVE_STAFF]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Kamala Devi")).toBeInTheDocument());
    expect(screen.queryByText("Suresh Kumar")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Active filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Inactive" }));

    expect(await screen.findByText("Suresh Kumar")).toBeInTheDocument();
    expect(screen.queryByText("Kamala Devi")).not.toBeInTheDocument();
  });

  it("narrows the list by name/bio_id search", async () => {
    mockUser("HR_ADMIN");
    mockCommonLists();
    mockedListHousekeepingStaff.mockResolvedValue([KAMALA, { ...INACTIVE_STAFF, is_active: true }]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Suresh Kumar")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Search housekeeping staff"), "BIO-001");

    expect(screen.getByText("Kamala Devi")).toBeInTheDocument();
    expect(screen.queryByText("Suresh Kumar")).not.toBeInTheDocument();
  });

  it("narrows the list with the campus filter (global-scope role only)", async () => {
    mockUser("HR_ADMIN");
    mockCommonLists();
    mockedListHousekeepingStaff.mockResolvedValue([KAMALA, { ...KAMALA, id: "hk-3", name: "Other Campus", campus_id: "c-sclas" }]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Other Campus")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));

    expect(screen.getByText("Kamala Devi")).toBeInTheDocument();
    expect(screen.queryByText("Other Campus")).not.toBeInTheDocument();
  });

  it("hides the campus filter/column for a single-campus role (RECRUITMENT_OFFICER)", async () => {
    mockUser("RECRUITMENT_OFFICER", "c-sse");
    mockCommonLists();
    mockedListHousekeepingStaff.mockResolvedValue([KAMALA]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Kamala Devi")).toBeInTheDocument());
    expect(screen.queryByRole("combobox", { name: "Campus filter" })).not.toBeInTheDocument();
  });

  it("hides Add staff/Bulk upload/Upload history/Edit/Delete for a role without HOUSEKEEPING_STAFF_MANAGEMENT_ROLES", async () => {
    mockUser("CAMPUS_HOD", "c-sse");
    mockCommonLists();
    mockedListHousekeepingStaff.mockResolvedValue([KAMALA]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Kamala Devi")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Add staff" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bulk upload" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload history" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete housekeeping staff Kamala Devi" })).not.toBeInTheDocument();
  });

  it("shows Add staff for RECRUITMENT_OFFICER (broader write set than Departments)", async () => {
    mockUser("RECRUITMENT_OFFICER", "c-sse");
    mockCommonLists();
    mockedListHousekeepingStaff.mockResolvedValue([KAMALA]);

    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: "Add staff" })).toBeInTheDocument());
  });

  it("shows Bulk upload and Upload history for a canManage user, gated the same as Add staff (Phase J)", async () => {
    mockUser("HR_ADMIN");
    mockCommonLists();
    mockedListHousekeepingStaff.mockResolvedValue([KAMALA]);

    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: "Bulk upload" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Upload history" })).toBeInTheDocument();
  });

  it("opens the Upload history dialog scoped to HousekeepingStaff's own bulk-upload batches", async () => {
    mockUser("HR_ADMIN");
    mockCommonLists();
    mockedListHousekeepingStaff.mockResolvedValue([KAMALA]);
    mockedListBulkUploads.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload history" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Upload history" }));

    expect(await screen.findByText("Housekeeping staff bulk upload history")).toBeInTheDocument();
    await waitFor(() =>
      expect(mockedListBulkUploads).toHaveBeenCalledWith(
        expect.objectContaining({ entity_type: "HOUSEKEEPING_STAFF" }),
      ),
    );
  });

  it("opens the drawer in edit mode with the row's data pre-filled", async () => {
    mockUser("HR_ADMIN");
    mockCommonLists();
    mockedListHousekeepingStaff.mockResolvedValue([KAMALA]);

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(await screen.findByText("Edit housekeeping staff")).toBeInTheDocument();
    expect(screen.getByDisplayValue("BIO-001")).toBeInTheDocument();
  });

  it("deletes a housekeeping staff record via the confirm dialog and refreshes the list", async () => {
    mockUser("HR_ADMIN");
    mockCommonLists();
    mockedListHousekeepingStaff.mockResolvedValue([KAMALA]);
    mockedDeleteHousekeepingStaff.mockResolvedValue(undefined);

    renderPage();
    await waitFor(() => expect(screen.getByText("Kamala Devi")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Delete housekeeping staff Kamala Devi" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(mockedDeleteHousekeepingStaff).toHaveBeenCalledWith("hk-1"));
  });
});
