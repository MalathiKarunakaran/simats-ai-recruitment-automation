import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import { ApiError } from "@/api/client";
import * as designationsApi from "@/api/designations";
import * as housekeepingStaffApi from "@/api/housekeepingStaff";
import * as locationsApi from "@/api/locations";
import type { CampusRead, DesignationRead, HousekeepingStaffRead, LocationRead } from "@/api/types";
import { HousekeepingStaffFormDrawer } from "@/components/housekeepingStaff/HousekeepingStaffFormDrawer";

vi.mock("@/api/campuses");
vi.mock("@/api/designations");
vi.mock("@/api/locations");
vi.mock("@/api/housekeepingStaff");

const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedListDesignations = vi.mocked(designationsApi.listDesignations);
const mockedListLocations = vi.mocked(locationsApi.listLocations);
const mockedCreate = vi.mocked(housekeepingStaffApi.createHousekeepingStaff);
const mockedUpdate = vi.mocked(housekeepingStaffApi.updateHousekeepingStaff);

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
const SCLAS_LOCATION: LocationRead = { ...SSE_LOCATION, id: "l-sclas-1", campus_id: "c-sclas", name: "SCLAS Block" };

const RECORD: HousekeepingStaffRead = {
  id: "hk-1",
  campus_id: "c-sse",
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

function renderDrawer(props: Partial<ComponentProps<typeof HousekeepingStaffFormDrawer>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <HousekeepingStaffFormDrawer
        open
        onOpenChange={onOpenChange}
        record={null}
        canChooseCampus
        defaultCampusId=""
        onSaved={onSaved}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange, onSaved };
}

describe("HousekeepingStaffFormDrawer", () => {
  // Some tests below assert `.not.toHaveBeenCalled()` on the mutation mocks
  // -- reset call history between tests so an earlier test's successful
  // submit doesn't leak into a later test's "blocked" assertion (mock
  // *implementations* still get set explicitly per-test via
  // mockResolvedValue/mockRejectedValue, so clearAllMocks -- not
  // resetAllMocks -- is enough here).
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Exercises every field via real Radix Select pointer interactions in
  // sequence (campus/designation/location/shift) -- legitimately close to
  // the default 5s test timeout on a cold run, not a hang (verified: passes
  // consistently, just slow); bumped rather than trimmed so the test still
  // covers the full real create flow end to end.
  it("creates a housekeeping staff record for a global-scope role, including campus picker", async () => {
    mockedListCampuses.mockResolvedValue([SSE, SCLAS]);
    mockedListDesignations.mockResolvedValue([HK_DESIGNATION]);
    mockedListLocations.mockResolvedValue([SSE_LOCATION, SCLAS_LOCATION]);
    mockedCreate.mockResolvedValue(RECORD);

    const { onSaved, onOpenChange } = renderDrawer();

    expect(await screen.findByText("Add housekeeping staff")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Campus" }));
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));

    await userEvent.type(screen.getByLabelText("Bio ID"), "BIO-001");
    await userEvent.type(screen.getByLabelText("Name"), "Kamala Devi");

    await userEvent.click(screen.getByRole("combobox", { name: "Designation" }));
    await userEvent.click(await screen.findByRole("option", { name: "Housekeeping Supervisor" }));

    await userEvent.click(screen.getByRole("combobox", { name: "Location" }));
    await userEvent.click(await screen.findByRole("option", { name: "Central Library" }));

    await userEvent.click(screen.getByRole("combobox", { name: "Shift" }));
    await userEvent.click(await screen.findByRole("option", { name: "Morning" }));

    await userEvent.click(screen.getByRole("button", { name: "Add staff" }));

    await waitFor(() =>
      expect(mockedCreate).toHaveBeenCalledWith({
        campus_id: "c-sse",
        bio_id: "BIO-001",
        name: "Kamala Devi",
        designation_id: "d-hk-1",
        location_id: "l-sse-1",
        block: null,
        floor_venue: null,
        shift: "MORNING",
        supervisor: null,
        is_active: true,
      }),
    );
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  }, 10000);

  it("locks the campus for a single-campus role (no campus picker) in create mode", async () => {
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDesignations.mockResolvedValue([HK_DESIGNATION]);
    mockedListLocations.mockResolvedValue([SSE_LOCATION]);

    renderDrawer({ canChooseCampus: false, defaultCampusId: "c-sse" });

    expect(await screen.findByText("SSE")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Campus" })).not.toBeInTheDocument();
  });

  it("only offers HOUSEKEEPING-category designations", async () => {
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDesignations.mockResolvedValue([HK_DESIGNATION]);
    mockedListLocations.mockResolvedValue([SSE_LOCATION]);

    renderDrawer({ canChooseCampus: false, defaultCampusId: "c-sse" });

    await waitFor(() => expect(mockedListDesignations).toHaveBeenCalledWith({ category: "HOUSEKEEPING", isActive: true }));
  });

  it("filters the location picker to the currently selected campus", async () => {
    mockedListCampuses.mockResolvedValue([SSE, SCLAS]);
    mockedListDesignations.mockResolvedValue([HK_DESIGNATION]);
    mockedListLocations.mockResolvedValue([SSE_LOCATION, SCLAS_LOCATION]);

    renderDrawer();

    await userEvent.click(screen.getByRole("combobox", { name: "Campus" }));
    await userEvent.click(await screen.findByRole("option", { name: "SCLAS" }));

    await userEvent.click(screen.getByRole("combobox", { name: "Location" }));
    expect(await screen.findByRole("option", { name: "SCLAS Block" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Central Library" })).not.toBeInTheDocument();
  });

  it("shows required-field errors and blocks submit when bio_id/name are empty", async () => {
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDesignations.mockResolvedValue([HK_DESIGNATION]);
    mockedListLocations.mockResolvedValue([SSE_LOCATION]);

    renderDrawer({ canChooseCampus: false, defaultCampusId: "c-sse" });
    await screen.findByText("Add housekeeping staff");

    await userEvent.click(screen.getByRole("button", { name: "Add staff" }));

    expect(await screen.findByText("Bio ID is required")).toBeInTheDocument();
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("blocks submit with an inline message when designation/location/shift are unset", async () => {
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDesignations.mockResolvedValue([HK_DESIGNATION]);
    mockedListLocations.mockResolvedValue([SSE_LOCATION]);

    renderDrawer({ canChooseCampus: false, defaultCampusId: "c-sse" });
    await screen.findByText("Add housekeeping staff");

    await userEvent.type(screen.getByLabelText("Bio ID"), "BIO-001");
    await userEvent.type(screen.getByLabelText("Name"), "Kamala Devi");
    await userEvent.click(screen.getByRole("button", { name: "Add staff" }));

    expect(await screen.findByText("Pick a Housekeeping designation.")).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("edits an existing record with the campus locked to its own (read-only)", async () => {
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDesignations.mockResolvedValue([HK_DESIGNATION]);
    mockedListLocations.mockResolvedValue([SSE_LOCATION]);
    mockedUpdate.mockResolvedValue({ ...RECORD, name: "Kamala D." });

    renderDrawer({ record: RECORD, canChooseCampus: true, defaultCampusId: "" });

    expect(await screen.findByText("Edit housekeeping staff")).toBeInTheDocument();
    expect(screen.getByDisplayValue("BIO-001")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Kamala Devi")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Campus" })).not.toBeInTheDocument();
    expect(await screen.findByText("SSE")).toBeInTheDocument();

    const nameInput = screen.getByLabelText("Name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Kamala D.");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith("hk-1", {
        bio_id: "BIO-001",
        name: "Kamala D.",
        designation_id: "d-hk-1",
        location_id: "l-sse-1",
        block: "Block A",
        floor_venue: "Ground Floor",
        shift: "MORNING",
        supervisor: "Ramesh",
        is_active: true,
      }),
    );
  });

  // glowing-zooming-hamming.md Phase G's additive prop extension --
  // HousekeepingStrengthTable's own "Add staff to this location" action
  // pre-fills both fields ahead of the drawer opening, with the campus
  // locked (canChooseCampus={false}) since the location already fixes it.
  it("pre-fills campus/location from initialCampusId/initialLocationId in create mode, with the campus locked", async () => {
    mockedListCampuses.mockResolvedValue([SSE, SCLAS]);
    mockedListDesignations.mockResolvedValue([HK_DESIGNATION]);
    mockedListLocations.mockResolvedValue([SSE_LOCATION, SCLAS_LOCATION]);
    mockedCreate.mockResolvedValue(RECORD);

    renderDrawer({
      canChooseCampus: false,
      defaultCampusId: "",
      initialCampusId: "c-sse",
      initialLocationId: "l-sse-1",
    });

    expect(await screen.findByText("Add housekeeping staff")).toBeInTheDocument();
    // Campus locked to the pre-filled value (plain text, not a picker).
    expect(screen.queryByRole("combobox", { name: "Campus" })).not.toBeInTheDocument();
    expect(await screen.findByText("SSE")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Bio ID"), "BIO-002");
    await userEvent.type(screen.getByLabelText("Name"), "New Staffer");
    await userEvent.click(screen.getByRole("combobox", { name: "Designation" }));
    await userEvent.click(await screen.findByRole("option", { name: "Housekeeping Supervisor" }));
    // Location is already pre-filled to "Central Library" (l-sse-1) --
    // confirmed via the submitted payload below, not re-selected here.
    await userEvent.click(screen.getByRole("combobox", { name: "Shift" }));
    await userEvent.click(await screen.findByRole("option", { name: "Morning" }));

    await userEvent.click(screen.getByRole("button", { name: "Add staff" }));

    await waitFor(() =>
      expect(mockedCreate).toHaveBeenCalledWith(
        expect.objectContaining({ campus_id: "c-sse", location_id: "l-sse-1" }),
      ),
    );
  }, 10000);

  // HousekeepingStaffListPage.tsx's own usage omits both new props --
  // confirms the seeding effect's existing behavior (defaultCampusId,
  // blank location) is unchanged when neither is supplied.
  it("falls back to defaultCampusId and a blank location when initialCampusId/initialLocationId are omitted", async () => {
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDesignations.mockResolvedValue([HK_DESIGNATION]);
    mockedListLocations.mockResolvedValue([SSE_LOCATION]);

    renderDrawer({ canChooseCampus: false, defaultCampusId: "c-sse" });

    expect(await screen.findByText("Add housekeeping staff")).toBeInTheDocument();
    expect(await screen.findByText("SSE")).toBeInTheDocument();
    // Nothing pre-selected -- the trigger still shows its placeholder text
    // rather than a resolved location name.
    expect(screen.getByText("Select a location")).toBeInTheDocument();
  });

  it("surfaces the backend's exact bio_id conflict message inline", async () => {
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDesignations.mockResolvedValue([HK_DESIGNATION]);
    mockedListLocations.mockResolvedValue([SSE_LOCATION]);
    mockedCreate.mockRejectedValue(new ApiError(409, "bio_id 'BIO-001' is already in use on this campus."));

    renderDrawer({ canChooseCampus: false, defaultCampusId: "c-sse" });
    await screen.findByText("Add housekeeping staff");

    await userEvent.type(screen.getByLabelText("Bio ID"), "BIO-001");
    await userEvent.type(screen.getByLabelText("Name"), "Kamala Devi");
    await userEvent.click(screen.getByRole("combobox", { name: "Designation" }));
    await userEvent.click(await screen.findByRole("option", { name: "Housekeeping Supervisor" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Location" }));
    await userEvent.click(await screen.findByRole("option", { name: "Central Library" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Shift" }));
    await userEvent.click(await screen.findByRole("option", { name: "Morning" }));
    await userEvent.click(screen.getByRole("button", { name: "Add staff" }));

    const dialog = screen.getByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByText("bio_id 'BIO-001' is already in use on this campus.")).toBeInTheDocument(),
    );
  }, 10000);
});
