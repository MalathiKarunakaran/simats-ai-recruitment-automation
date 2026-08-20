import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import { ApiError } from "@/api/client";
import * as locationsApi from "@/api/locations";
import * as sanctionedStrengthApi from "@/api/sanctionedStrength";
import type { CampusRead, LocationRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { LocationsPage } from "@/pages/LocationsPage";

vi.mock("@/api/campuses");
vi.mock("@/api/locations");
// Phase J (glowing-zooming-hamming.md) -- LocationBulkUploadDialog/the
// Upload history dialog both pull from this module too (the shared
// error-report download and the shared bulk-uploads list respectively).
vi.mock("@/api/sanctionedStrength");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedListLocations = vi.mocked(locationsApi.listLocations);
const mockedCreateLocation = vi.mocked(locationsApi.createLocation);
const mockedUpdateLocation = vi.mocked(locationsApi.updateLocation);
const mockedDeleteLocation = vi.mocked(locationsApi.deleteLocation);
const mockedListBulkUploads = vi.mocked(sanctionedStrengthApi.listSanctionedStrengthBulkUploads);

function mockUser(role: UserRead["role"], campusId: string | null = null) {
  mockedUseAuth.mockReturnValue({
    user: { id: "u-1", role, campus_id: campusId } as UserRead,
    isLoading: false,
    login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
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

const LIBRARY: LocationRead = {
  id: "l-library",
  campus_id: "c-sse",
  name: "Central Library",
  block_building: "Block A",
  floor_venue: "Ground Floor",
  category: "TEACHING",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const HK_STORE: LocationRead = {
  ...LIBRARY,
  id: "l-hk-store",
  name: "Housekeeping Store",
  block_building: "Block B",
  floor_venue: "Basement",
  category: "HOUSEKEEPING",
  is_active: false,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LocationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LocationsPage", () => {
  it("lists active locations with name, block/building, floor/venue, campus, and category", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE, SCLAS]);
    mockedListLocations.mockResolvedValue([LIBRARY]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());
    expect(screen.getByText("Block A")).toBeInTheDocument();
    expect(screen.getByText("Ground Floor")).toBeInTheDocument();
    expect(screen.getByText("SSE")).toBeInTheDocument();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
  });

  it("hides inactive locations by default, reachable via the Active filter", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListLocations.mockResolvedValue([LIBRARY, HK_STORE]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());
    expect(screen.queryByText("Housekeeping Store")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Active filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Inactive" }));

    expect(await screen.findByText("Housekeeping Store")).toBeInTheDocument();
    expect(screen.queryByText("Central Library")).not.toBeInTheDocument();
  });

  it("segregates locations into Teaching/Non-Teaching/Housekeeping tabs", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListLocations.mockResolvedValue([LIBRARY, { ...HK_STORE, is_active: true }]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());
    expect(screen.getByText("Housekeeping Store")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /^Teaching/ }));
    expect(screen.getByText("Central Library")).toBeInTheDocument();
    expect(screen.queryByText("Housekeeping Store")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /^Housekeeping/ }));
    expect(screen.getByText("Housekeeping Store")).toBeInTheDocument();
    expect(screen.queryByText("Central Library")).not.toBeInTheDocument();
  });

  it("only shows an uncategorized location under the All tab, not Teaching/Non-Teaching/Housekeeping", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    const UNCATEGORIZED: LocationRead = { ...LIBRARY, id: "l-uncat", name: "Guest House", category: null };
    mockedListLocations.mockResolvedValue([LIBRARY, UNCATEGORIZED]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());

    // Counted under "All" but not silently dropped from the page.
    expect(screen.getByRole("tab", { name: "All (2)" })).toBeInTheDocument();
    expect(screen.getByText("Guest House")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /^Teaching/ }));
    expect(screen.getByText("Central Library")).toBeInTheDocument();
    expect(screen.queryByText("Guest House")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /^Non-Teaching/ }));
    expect(screen.queryByText("Guest House")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /^Housekeeping/ }));
    expect(screen.queryByText("Guest House")).not.toBeInTheDocument();
  });

  it("only shows the campus filter to a global-scope role, not a single-campus role", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE, SCLAS]);
    mockedListLocations.mockResolvedValue([LIBRARY]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());
    expect(screen.getByRole("combobox", { name: "Campus filter" })).toBeInTheDocument();
  });

  it("hides the campus filter for a single-campus role (RECRUITMENT_OFFICER)", async () => {
    mockUser("RECRUITMENT_OFFICER", "c-sse");
    mockedListCampuses.mockResolvedValue([SSE, SCLAS]);
    mockedListLocations.mockResolvedValue([LIBRARY]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());
    expect(screen.queryByRole("combobox", { name: "Campus filter" })).not.toBeInTheDocument();
  });

  it("shows live counts on each CategoryTabs tab, reflecting the campus filter (not just category)", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE, SCLAS]);
    mockedListLocations.mockResolvedValue([
      LIBRARY,
      { ...HK_STORE, is_active: true },
      { ...LIBRARY, id: "l-3", name: "Physics Block", campus_id: "c-sclas" },
    ]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());

    // Unfiltered: 2 TEACHING (Central Library, Physics Block) + 1 HOUSEKEEPING = 3 All.
    expect(screen.getByRole("tab", { name: "All (3)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Teaching (2)" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));

    expect(await screen.findByRole("tab", { name: "All (2)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Teaching (1)" })).toBeInTheDocument();
  });

  it("hides New location, Bulk upload, Upload history and Edit for a role without LOCATION_MANAGEMENT_ROLES", async () => {
    mockUser("CAMPUS_HOD", "c-sse");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListLocations.mockResolvedValue([LIBRARY]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "New location" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bulk upload" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload history" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("shows New location for RECRUITMENT_OFFICER (broader write set than Departments)", async () => {
    mockUser("RECRUITMENT_OFFICER", "c-sse");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListLocations.mockResolvedValue([LIBRARY]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "New location" })).toBeInTheDocument();
  });

  it("shows Bulk upload and Upload history for a canManage user, gated the same as New location (Phase J)", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListLocations.mockResolvedValue([LIBRARY]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Bulk upload" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload history" })).toBeInTheDocument();
  });

  it("opens the Upload history dialog scoped to Location's own bulk-upload batches", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListLocations.mockResolvedValue([LIBRARY]);
    mockedListBulkUploads.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });

    renderPage();
    await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Upload history" }));

    expect(await screen.findByText("Location bulk upload history")).toBeInTheDocument();
    await waitFor(() =>
      expect(mockedListBulkUploads).toHaveBeenCalledWith(expect.objectContaining({ entity_type: "LOCATION" })),
    );
  });

  it("creates a location with block/floor/category for HR Admin", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListLocations.mockResolvedValue([LIBRARY]);
    mockedCreateLocation.mockResolvedValue({ ...LIBRARY, id: "l-2", name: "Physics Lab" });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "New location" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New location" }));
    await userEvent.click(screen.getAllByRole("combobox")[0]);
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));
    await userEvent.type(screen.getByLabelText("Name"), "Physics Lab");
    await userEvent.type(screen.getByLabelText("Block / Building (optional)"), "Block C");
    await userEvent.click(screen.getByRole("button", { name: "Create location" }));

    await waitFor(() =>
      expect(mockedCreateLocation).toHaveBeenCalledWith({
        campus_id: "c-sse",
        name: "Physics Lab",
        block_building: "Block C",
        floor_venue: null,
        category: null,
        is_active: true,
      }),
    );
  });

  it("creates a location for RECRUITMENT_OFFICER locked to their own campus (no campus picker)", async () => {
    mockUser("RECRUITMENT_OFFICER", "c-sse");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListLocations.mockResolvedValue([LIBRARY]);
    mockedCreateLocation.mockResolvedValue({ ...LIBRARY, id: "l-2", name: "Store Room" });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "New location" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New location" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("SSE")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Name"), "Store Room");
    await userEvent.click(screen.getByRole("button", { name: "Create location" }));

    await waitFor(() =>
      expect(mockedCreateLocation).toHaveBeenCalledWith({
        campus_id: "c-sse",
        name: "Store Room",
        block_building: null,
        floor_venue: null,
        category: null,
        is_active: true,
      }),
    );
  });

  it("edits an existing location's name/block without changing its campus", async () => {
    mockUser("SUPER_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListLocations.mockResolvedValue([LIBRARY]);
    mockedUpdateLocation.mockResolvedValue({ ...LIBRARY, block_building: "Block A2" });

    renderPage();
    await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const blockInput = screen.getByLabelText("Block / Building (optional)");
    await userEvent.clear(blockInput);
    await userEvent.type(blockInput, "Block A2");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mockedUpdateLocation).toHaveBeenCalledWith("l-library", {
        name: "Central Library",
        block_building: "Block A2",
        floor_venue: "Ground Floor",
        category: "TEACHING",
        is_active: true,
      }),
    );
  });

  it("narrows the list with the campus filter", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE, SCLAS]);
    mockedListLocations.mockResolvedValue([LIBRARY, { ...HK_STORE, campus_id: "c-sclas", is_active: true }]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Housekeeping Store")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));

    expect(screen.getByText("Central Library")).toBeInTheDocument();
    expect(screen.queryByText("Housekeeping Store")).not.toBeInTheDocument();
  });

  it("narrows the list by name search", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListLocations.mockResolvedValue([LIBRARY, { ...HK_STORE, campus_id: "c-sse", is_active: true }]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Housekeeping Store")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Search locations"), "Central");

    expect(screen.getByText("Central Library")).toBeInTheDocument();
    expect(screen.queryByText("Housekeeping Store")).not.toBeInTheDocument();
  });

  it("hides Delete for a role without LOCATION_MANAGEMENT_ROLES", async () => {
    mockUser("CAMPUS_HOD", "c-sse");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListLocations.mockResolvedValue([LIBRARY]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Delete location Central Library" })).not.toBeInTheDocument();
  });

  it("deletes a location via the confirm dialog and refreshes the list", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListLocations.mockResolvedValue([LIBRARY]);
    mockedDeleteLocation.mockResolvedValue(undefined);

    renderPage();
    await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Delete location Central Library" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(mockedDeleteLocation).toHaveBeenCalledWith("l-library"));
  });

  it("surfaces the backend's exact error message inline in the delete dialog", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListLocations.mockResolvedValue([LIBRARY]);
    mockedDeleteLocation.mockRejectedValue(new ApiError(500, "Something went wrong deleting this location."));

    renderPage();
    await waitFor(() => expect(screen.getByText("Central Library")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Delete location Central Library" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm delete" }));

    await waitFor(() =>
      expect(within(dialog).getByText("Something went wrong deleting this location.")).toBeInTheDocument(),
    );
  });
});
