import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as auditLogsApi from "@/api/auditLogs";
import * as designationsApi from "@/api/designations";
import * as locationsApi from "@/api/locations";
import * as sanctionedStrengthApi from "@/api/sanctionedStrength";
import type {
  AuditLogRead,
  DepartmentDesignationBreakdownRow,
  DesignationRead,
  LocationRead,
  SanctionedStrengthAvailabilityRead,
  SanctionedStrengthHistoryRead,
  SanctionedStrengthRead,
  VacancyRequestRead,
} from "@/api/types";
import * as vacancyRequestsApi from "@/api/vacancyRequests";
import { SanctionedStrengthDrawer } from "@/components/sanctionedStrength/SanctionedStrengthDrawer";

vi.mock("@/api/designations");
vi.mock("@/api/locations");
vi.mock("@/api/sanctionedStrength");
vi.mock("@/api/vacancyRequests");
vi.mock("@/api/auditLogs");

const mockedListDesignations = vi.mocked(designationsApi.listDesignations);
const mockedListLocations = vi.mocked(locationsApi.listLocations);
const mockedGetBreakdown = vi.mocked(sanctionedStrengthApi.getDepartmentSanctionedStrengthBreakdown);
const mockedCreate = vi.mocked(sanctionedStrengthApi.createSanctionedStrength);
const mockedUpdate = vi.mocked(sanctionedStrengthApi.updateSanctionedStrength);
const mockedGetAvailability = vi.mocked(sanctionedStrengthApi.getSanctionedStrengthAvailability);
const mockedGetHistory = vi.mocked(sanctionedStrengthApi.getSanctionedStrengthHistory);
const mockedListVacancyRequests = vi.mocked(vacancyRequestsApi.listVacancyRequests);
const mockedListAuditLogs = vi.mocked(auditLogsApi.listAuditLogs);

const now = "2026-01-01T00:00:00Z";

const BREAKDOWN_ROWS: DepartmentDesignationBreakdownRow[] = [
  {
    designation_id: "des-1",
    designation_name: "Assistant Professor",
    sanctioned_strength_id: "ss-1",
    approved: 10,
    working: 7,
    working_override: null,
    vacancy: 3,
    effective_from: "2026-08-10",
    remarks: "Existing sanction",
    location_id: "loc-1",
    location_name: "Block A",
  },
  {
    designation_id: "des-2",
    designation_name: "Professor",
    sanctioned_strength_id: null,
    approved: 4,
    working: 4,
    working_override: null,
    vacancy: 0,
    effective_from: null,
    remarks: null,
    location_id: null,
    location_name: null,
  },
];

const ASSOCIATE_PROFESSOR: DesignationRead = {
  id: "des-3",
  name: "Associate Professor",
  category: "TEACHING",
  qualification: "PhD",
  min_experience: "5+ years",
  employment_type: "FULL_TIME",
  required_skills: null,
  is_active: true,
  department_ids: ["d-cse"],
  created_at: now,
  updated_at: now,
};

const LAB_ASSISTANT_NON_TEACHING: DesignationRead = {
  id: "des-4",
  name: "Lab Assistant",
  category: "NON_TEACHING",
  qualification: "BSc",
  min_experience: "1+ years",
  employment_type: "FULL_TIME",
  required_skills: null,
  is_active: true,
  department_ids: ["d-cse"],
  created_at: now,
  updated_at: now,
};

const LOCATION_A: LocationRead = {
  id: "loc-1",
  campus_id: "c-sse",
  name: "Block A",
  block_building: "A",
  floor_venue: "1st Floor",
  category: "TEACHING",
  is_active: true,
  created_at: now,
  updated_at: now,
};

const SANCTIONED_STRENGTH_ROW: SanctionedStrengthRead = {
  id: "ss-1",
  campus_id: "c-sse",
  department_id: "d-cse",
  designation_id: "des-1",
  category: "TEACHING",
  approved_strength: 12,
  working_override: null,
  effective_from: "2026-08-10",
  remarks: "Revised",
  is_active: true,
  created_by_id: "u-1",
  updated_by_id: "u-1",
  created_at: now,
  updated_at: now,
};

function renderDrawer(props: Partial<ComponentProps<typeof SanctionedStrengthDrawer>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SanctionedStrengthDrawer
          open
          onOpenChange={onOpenChange}
          mode="edit"
          canManage
          canViewAuditLog
          campusId="c-sse"
          campusLabel="SSE"
          departmentId="d-cse"
          departmentLabel="Computer Science"
          category="TEACHING"
          designationId="des-1"
          designationName="Assistant Professor"
          onSaved={onSaved}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onOpenChange, onSaved };
}

describe("SanctionedStrengthDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetBreakdown.mockResolvedValue(BREAKDOWN_ROWS);
    mockedListDesignations.mockResolvedValue([ASSOCIATE_PROFESSOR, LAB_ASSISTANT_NON_TEACHING]);
    mockedListLocations.mockResolvedValue([LOCATION_A]);
  });

  describe("default tab by role (mode/canManage)", () => {
    it("defaults to Basic Info for a write-role (canManage) user", async () => {
      renderDrawer({ mode: "edit", canManage: true });
      expect(await screen.findByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    });

    it("defaults to History for a read-only viewer (canManage=false)", async () => {
      renderDrawer({ mode: "view", canManage: false });
      expect(await screen.findByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
    });

    it("hides the Audit Log tab when canViewAuditLog is false", async () => {
      renderDrawer({ canViewAuditLog: false });
      await screen.findByRole("tab", { name: "Details" });
      expect(screen.queryByRole("tab", { name: "Audit Log" })).not.toBeInTheDocument();
    });

    it("shows the Audit Log tab when canViewAuditLog is true", async () => {
      renderDrawer({ canViewAuditLog: true });
      expect(await screen.findByRole("tab", { name: "Audit Log" })).toBeInTheDocument();
    });
  });

  describe("Basic Info tab", () => {
    it("shows Campus/Department/Designation/Category read-only in view mode", async () => {
      renderDrawer({ mode: "view", canManage: false });
      await userEvent.click(await screen.findByRole("tab", { name: "Details" }));

      expect(screen.getByText("SSE")).toBeInTheDocument();
      expect(screen.getByText("Computer Science")).toBeInTheDocument();
      // Rendered twice by design: the modal header shows the record identity,
      // and the Position section repeats it as a read-only field.
      expect((await screen.findAllByText("Assistant Professor")).length).toBeGreaterThan(0);
      expect(screen.queryByRole("combobox", { name: "Designation" })).not.toBeInTheDocument();
      // Twice by design: the header CategoryBadge and the Position section.
      expect(screen.getAllByText("TEACHING").length).toBeGreaterThan(0);
      expect(screen.queryByRole("combobox", { name: "Designation" })).not.toBeInTheDocument();
    });

    it("shows a category-filtered Designation picker in Add mode, excluding designations already in the breakdown", async () => {
      renderDrawer({ mode: "add", designationId: null, designationName: null });
      await screen.findByRole("tab", { name: "Details" });

      await userEvent.click(await screen.findByRole("combobox", { name: "Designation" }));
      // Category-filtered: NON_TEACHING's Lab Assistant is never offered
      // for a TEACHING department.
      expect(screen.queryByRole("option", { name: "Lab Assistant" })).not.toBeInTheDocument();
      // Already-present breakdown rows (Assistant Professor/Professor) are excluded too.
      expect(screen.queryByRole("option", { name: "Assistant Professor" })).not.toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "Professor" })).not.toBeInTheDocument();
      expect(await screen.findByRole("option", { name: "Associate Professor" })).toBeInTheDocument();
    });
  });

  describe("Strength tab", () => {
    it("pre-fills Approved/Working/Vacancy/Effective from/Remarks from the breakdown and PATCHes when sanctioned_strength_id exists", async () => {
      mockedUpdate.mockResolvedValue(SANCTIONED_STRENGTH_ROW);
      const { onSaved, onOpenChange } = renderDrawer();

      await userEvent.click(await screen.findByRole("tab", { name: "Details" }));

      const approvedInput = await screen.findByLabelText("Approved / Sanctioned");
      expect(approvedInput).toHaveValue(10);
      // Working is now an input (2026-08-30). This row has no override, so
      // the box is empty and the live count 7 shows as the placeholder --
      // pre-filling it with 7 would silently promote a counted figure into a
      // typed one on the next save.
      expect(screen.getByLabelText("Working")).toHaveValue(null);
      expect(screen.getByText("Live staff count (7). Type a number to override it.")).toBeInTheDocument();
      expect(screen.getByLabelText("Effective from")).toHaveValue("2026-08-10");
      expect(screen.getByLabelText("Remarks")).toHaveValue("Existing sanction");

      await userEvent.clear(approvedInput);
      await userEvent.type(approvedInput, "12");
      await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

      await waitFor(() =>
        expect(mockedUpdate).toHaveBeenCalledWith("ss-1", {
          approved_strength: 12,
          working_override: null,
          effective_from: "2026-08-10",
          remarks: "Existing sanction",
          location_id: "loc-1",
        }),
      );
      expect(onSaved).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("POSTs when the target designation has no sanctioned_strength_id yet", async () => {
      mockedCreate.mockResolvedValue({ ...SANCTIONED_STRENGTH_ROW, id: "ss-2", designation_id: "des-2" });
      renderDrawer({ designationId: "des-2", designationName: "Professor" });

      await userEvent.click(await screen.findByRole("tab", { name: "Details" }));
      const approvedInput = await screen.findByLabelText("Approved / Sanctioned");
      expect(approvedInput).toHaveValue(4);
      expect(screen.getByLabelText("Remarks")).toHaveValue("");

      await userEvent.clear(approvedInput);
      await userEvent.type(approvedInput, "6");
      await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

      await waitFor(() =>
        expect(mockedCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            campus_id: "c-sse",
            department_id: "d-cse",
            designation_id: "des-2",
            approved_strength: 6,
          }),
        ),
      );
    });

    it("Add mode POSTs a brand-new row for the newly selected designation, with the Add button label", async () => {
      mockedCreate.mockResolvedValue({ ...SANCTIONED_STRENGTH_ROW, id: "ss-3", designation_id: "des-3" });
      renderDrawer({ mode: "add", designationId: null, designationName: null });

      await userEvent.click(await screen.findByRole("combobox", { name: "Designation" }));
      await userEvent.click(await screen.findByRole("option", { name: "Associate Professor" }));

      await userEvent.click(screen.getByRole("tab", { name: "Details" }));
      const approvedInput = await screen.findByLabelText("Approved / Sanctioned");
      await userEvent.clear(approvedInput);
      await userEvent.type(approvedInput, "5");

      expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Add" }));

      await waitFor(() =>
        expect(mockedCreate).toHaveBeenCalledWith(
          expect.objectContaining({ designation_id: "des-3", approved_strength: 5 }),
        ),
      );
    });

    // --- Working override (2026-08-30) -------------------------------------
    // The Working box writes SanctionedStrength.working_override. It exists
    // because this deployment has no HR feed, so the live roster count is 0
    // on every row and Vacancy always read equal to Approved.
    describe("Working override", () => {
      const OVERRIDDEN_ROWS: DepartmentDesignationBreakdownRow[] = [
        // `working` is the RESOLVED figure, so a row carrying an override of
        // 3 reports working: 3 -- the live count is not in this payload at
        // all, which is exactly what the "cleared" copy has to cope with.
        { ...BREAKDOWN_ROWS[0], working: 3, working_override: 3 },
        ...BREAKDOWN_ROWS.slice(1),
      ];

      it("recomputes Vacancy and Filled % from a typed override, live", async () => {
        renderDrawer();
        await userEvent.click(await screen.findByRole("tab", { name: "Details" }));

        await userEvent.type(await screen.findByLabelText("Working"), "4");

        // Approved 10, Working 4 -> Vacancy 6, Filled 40%. Without the
        // override these read 3 and 70% off the live count of 7.
        expect(screen.getByText("10 approved - 4 working")).toBeInTheDocument();
        expect(screen.getByText("40%")).toBeInTheDocument();
      });

      it("sends the typed override as a number on save", async () => {
        mockedUpdate.mockResolvedValue(SANCTIONED_STRENGTH_ROW);
        renderDrawer();
        await userEvent.click(await screen.findByRole("tab", { name: "Details" }));

        await userEvent.type(await screen.findByLabelText("Working"), "4");
        await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

        await waitFor(() =>
          expect(mockedUpdate).toHaveBeenCalledWith("ss-1", expect.objectContaining({ working_override: 4 })),
        );
      });

      it("seeds the box from an existing override and says the figure was typed", async () => {
        mockedGetBreakdown.mockResolvedValue(OVERRIDDEN_ROWS);
        renderDrawer();
        await userEvent.click(await screen.findByRole("tab", { name: "Details" }));

        expect(await screen.findByLabelText("Working")).toHaveValue(3);
        expect(
          screen.getByText("Entered manually. Clear this box to use the live staff count instead."),
        ).toBeInTheDocument();
      });

      it("clearing an existing override sends an explicit null, not an omitted key", async () => {
        // The backend keys this field off the key's PRESENCE, so omitting it
        // would make "clear this" a silent no-op that returns 200 OK.
        mockedGetBreakdown.mockResolvedValue(OVERRIDDEN_ROWS);
        mockedUpdate.mockResolvedValue(SANCTIONED_STRENGTH_ROW);
        renderDrawer();
        await userEvent.click(await screen.findByRole("tab", { name: "Details" }));

        await userEvent.clear(await screen.findByLabelText("Working"));
        expect(screen.getByText("Cleared — the live staff count applies once you save.")).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

        await waitFor(() =>
          expect(mockedUpdate).toHaveBeenCalledWith("ss-1", expect.objectContaining({ working_override: null })),
        );
      });

      it("shows -- rather than a guessed 0 while an override is being cleared", async () => {
        // The server sends the resolved `working` only, so once the override
        // it resolved from is gone the live count is genuinely unknown here.
        mockedGetBreakdown.mockResolvedValue(OVERRIDDEN_ROWS);
        renderDrawer();
        await userEvent.click(await screen.findByRole("tab", { name: "Details" }));

        await userEvent.clear(await screen.findByLabelText("Working"));

        expect(screen.queryByText("10 approved - 0 working")).not.toBeInTheDocument();
        // Scoped to the Vacancy tile -- "--" is the empty-value convention
        // across every read-only field in this modal, so a bare getByText
        // would match several of them.
        expect(screen.getByText("Vacancy").nextElementSibling).toHaveTextContent("--");
      });

      it("rejects a negative override, disabling Save", async () => {
        renderDrawer();
        await userEvent.click(await screen.findByRole("tab", { name: "Details" }));

        await userEvent.type(await screen.findByLabelText("Working"), "-2");

        expect(screen.getByText("Enter a whole number, 0 or more.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
        expect(mockedUpdate).not.toHaveBeenCalled();
      });

      it("counts as an unsaved change on its own, so closing asks first", async () => {
        const { onOpenChange } = renderDrawer();
        await userEvent.click(await screen.findByRole("tab", { name: "Details" }));

        await userEvent.type(await screen.findByLabelText("Working"), "4");
        await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(await screen.findByText("Discard unsaved changes?")).toBeInTheDocument();
        expect(onOpenChange).not.toHaveBeenCalledWith(false);
      });

      it("stays read-only for a viewer, showing the resolved figure and no input", async () => {
        mockedGetBreakdown.mockResolvedValue(OVERRIDDEN_ROWS);
        renderDrawer({ mode: "view", canManage: false });
        await userEvent.click(await screen.findByRole("tab", { name: "Details" }));

        expect(screen.queryByLabelText("Working")).not.toBeInTheDocument();
        expect(await screen.findByText("3")).toBeInTheDocument();
      });
    });

    it("rejects a non-numeric/negative Approved value, disabling Save", async () => {
      renderDrawer();
      await userEvent.click(await screen.findByRole("tab", { name: "Details" }));
      const approvedInput = await screen.findByLabelText("Approved / Sanctioned");
      await userEvent.clear(approvedInput);
      await userEvent.type(approvedInput, "-5");

      expect(screen.getByText("Enter a whole number, 0 or more.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
      expect(mockedUpdate).not.toHaveBeenCalled();
    });

    // Cancelling an EDITED form now asks first (2026-08-29 redesign) -- the
    // brief asked for a confirmation before closing with unsaved changes, so
    // the close is deliberately not immediate here.
    it("Cancel on an edited form asks before discarding, then closes without calling the API", async () => {
      const { onOpenChange } = renderDrawer();
      await userEvent.click(await screen.findByRole("tab", { name: "Details" }));
      const approvedInput = await screen.findByLabelText("Approved / Sanctioned");
      await userEvent.clear(approvedInput);
      await userEvent.type(approvedInput, "99");

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      // Still open -- the guard intercepted the close.
      expect(await screen.findByText("Discard unsaved changes?")).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);

      await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));

      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(mockedUpdate).not.toHaveBeenCalled();
      expect(mockedCreate).not.toHaveBeenCalled();
    });

    it("Cancel closes immediately when nothing has been edited", async () => {
      const { onOpenChange } = renderDrawer();
      await userEvent.click(await screen.findByRole("tab", { name: "Details" }));
      await screen.findByLabelText("Approved / Sanctioned");

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(screen.queryByText("Discard unsaved changes?")).not.toBeInTheDocument();
      expect(mockedUpdate).not.toHaveBeenCalled();
    });

    it("Keep editing dismisses the discard prompt and leaves the edit in place", async () => {
      const { onOpenChange } = renderDrawer();
      await userEvent.click(await screen.findByRole("tab", { name: "Details" }));
      const approvedInput = await screen.findByLabelText("Approved / Sanctioned");
      await userEvent.clear(approvedInput);
      await userEvent.type(approvedInput, "99");

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await userEvent.click(await screen.findByRole("button", { name: "Keep editing" }));

      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(await screen.findByLabelText("Approved / Sanctioned")).toHaveValue(99);
    });

    it("shows Approved/Working/Vacancy/Effective from/Remarks as plain read-only text in view mode (no inputs, no footer)", async () => {
      renderDrawer({ mode: "view", canManage: false });
      await userEvent.click(await screen.findByRole("tab", { name: "Details" }));

      expect(screen.queryByLabelText("Approved / Sanctioned")).not.toBeInTheDocument();
      expect(screen.getByText("10")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save Changes" })).not.toBeInTheDocument();
    });
  });

  describe("Location tab", () => {
    it("shows a campus/category-scoped Location picker, editable in edit mode, and sends location_id on save", async () => {
      mockedUpdate.mockResolvedValue(SANCTIONED_STRENGTH_ROW);
      renderDrawer();

      await userEvent.click(await screen.findByRole("tab", { name: "Details" }));
      expect(await screen.findByRole("combobox", { name: "Location" })).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));
      await waitFor(() =>
        expect(mockedUpdate).toHaveBeenCalledWith(
          "ss-1",
          expect.objectContaining({ location_id: "loc-1" }),
        ),
      );
    });

    it("requires a location when category is HOUSEKEEPING, blocking Save until one is picked", async () => {
      renderDrawer({ category: "HOUSEKEEPING", designationId: "des-2", designationName: "Professor" });
      await userEvent.click(await screen.findByRole("tab", { name: "Details" }));

      expect(await screen.findByText("Location is required for Housekeeping.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
    });

    it("shows the resolved location name as read-only text in view mode", async () => {
      renderDrawer({ mode: "view", canManage: false });
      await userEvent.click(await screen.findByRole("tab", { name: "Details" }));

      expect(await screen.findByText("Block A")).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Location" })).not.toBeInTheDocument();
    });
  });

  describe("Recruitment Status tab", () => {
    const AVAILABILITY: SanctionedStrengthAvailabilityRead = {
      approved: 10,
      working: 7,
      vacant: 3,
      already_requested: 1,
      available_to_request: 2,
    };

    it("fetches and renders approved/working/vacant/already_requested/available_to_request, with a Raise vacancy request CTA when vacant > 0", async () => {
      mockedGetAvailability.mockResolvedValue(AVAILABILITY);
      renderDrawer();

      await userEvent.click(await screen.findByRole("tab", { name: "Details" }));

      await waitFor(() =>
        expect(mockedGetAvailability).toHaveBeenCalledWith({
          campusId: "c-sse",
          departmentId: "d-cse",
          designationId: "des-1",
        }),
      );
      expect(await screen.findByText("2")).toBeInTheDocument(); // available_to_request
      const raiseLink = screen.getByRole("link", { name: "Raise vacancy request" });
      expect(raiseLink).toHaveAttribute(
        "href",
        "/vacancy-requests/new?campus=c-sse&department=d-cse&designation=des-1&maxCount=2",
      );
    });

    it("hides the Raise vacancy request CTA when vacant is 0", async () => {
      mockedGetAvailability.mockResolvedValue({ ...AVAILABILITY, vacant: 0 });
      renderDrawer();

      await userEvent.click(await screen.findByRole("tab", { name: "Details" }));

      await waitFor(() => expect(mockedGetAvailability).toHaveBeenCalled());
      expect(screen.queryByRole("link", { name: "Raise vacancy request" })).not.toBeInTheDocument();
    });
  });

  describe("Approval Status tab", () => {
    it("fetches vacancy requests filtered by department_id/designation_id and renders status/created/requested_by", async () => {
      const vacancyRequests: VacancyRequestRead[] = [
        {
          id: "vr-1",
          campus_id: "c-sse",
          department_id: "d-cse",
          designation_id: "des-1",
          role_category: "TEACHING",
          position_title: "Assistant Professor",
          employment_type: "FULL_TIME",
          requested_count: 2,
          qualification: "PhD",
          experience_required: "0+ years",
          salary_band_min: null,
          salary_band_max: null,
          jd_draft: null,
          remarks: null,
          skills: null,
          priority: "NORMAL",
          status: "DEAN_APPROVED",
          source: "MANUAL" as const,
          request_ref: null,
          location_id: null,
          required_by: null,
          requester_name: null,
          requester_email: null,
          requester_mobile: null,
          requested_by_id: "11111111-2222-3333-4444-555555555555",
          submitted_at: "2026-07-01T00:00:00Z",
          dean_reviewed_by_id: null,
          dean_reviewed_at: null,
          hr_reviewed_by_id: null,
          hr_reviewed_at: null,
          rejected_by_id: null,
          rejected_at: null,
          rejection_reason: null,
          cancelled_by_id: null,
          cancelled_at: null,
          cancellation_reason: null,
          is_over_sanction: false,
          over_sanction_justification: null,
          created_at: "2026-07-01T00:00:00Z",
          updated_at: "2026-07-01T00:00:00Z",
        },
      ];
      mockedListVacancyRequests.mockResolvedValue(vacancyRequests);
      renderDrawer();

      await userEvent.click(await screen.findByRole("tab", { name: "Details" }));

      await waitFor(() =>
        expect(mockedListVacancyRequests).toHaveBeenCalledWith(null, {
          departmentId: "d-cse",
          designationId: "des-1",
        }),
      );
      expect(await screen.findByText("Dean Approved")).toBeInTheDocument();
      expect(screen.getByText("11111111")).toBeInTheDocument();
    });

    it("shows an empty state when there are no vacancy requests for this designation", async () => {
      mockedListVacancyRequests.mockResolvedValue([]);
      renderDrawer();

      await userEvent.click(await screen.findByRole("tab", { name: "Details" }));

      expect(
        await screen.findByText("No vacancy requests raised for this designation yet."),
      ).toBeInTheDocument();
    });
  });

  describe("History tab", () => {
    it("shows 'Not yet sanctioned' when there is no sanctioned_strength_id", async () => {
      renderDrawer({ designationId: "des-2", designationName: "Professor" });
      await userEvent.click(await screen.findByRole("tab", { name: "History" }));

      expect(await screen.findByText("Not yet sanctioned")).toBeInTheDocument();
      expect(mockedGetHistory).not.toHaveBeenCalled();
    });

    it("fetches and renders old -> new, changed-by, and source per entry when sanctioned_strength_id exists", async () => {
      const historyEntries: SanctionedStrengthHistoryRead[] = [
        {
          id: "h-1",
          sanctioned_strength_id: "ss-1",
          old_value: 8,
          new_value: 10,
          changed_by_id: "11111111-2222-3333-4444-555555555555",
          changed_at: "2026-08-05T10:00:00Z",
          source: "MANUAL",
          bulk_upload_log_id: null,
        },
      ];
      mockedGetHistory.mockResolvedValue({ items: historyEntries, total: 1, limit: 50, offset: 0 });
      renderDrawer();

      await userEvent.click(await screen.findByRole("tab", { name: "History" }));

      await waitFor(() => expect(mockedGetHistory).toHaveBeenCalledWith("ss-1"));
      expect(await screen.findByText("8 → 10")).toBeInTheDocument();
      expect(screen.getByText("Manual")).toBeInTheDocument();
    });
  });

  describe("Audit Log tab", () => {
    it("shows 'Not yet sanctioned' when there is no sanctioned_strength_id", async () => {
      renderDrawer({ designationId: "des-2", designationName: "Professor" });
      await userEvent.click(await screen.findByRole("tab", { name: "Audit Log" }));

      expect(await screen.findByText("Not yet sanctioned")).toBeInTheDocument();
      expect(mockedListAuditLogs).not.toHaveBeenCalled();
    });

    it("fetches GET /audit-logs filtered by entity_type=SanctionedStrength and entity_id, and renders entries", async () => {
      const entries: AuditLogRead[] = [
        {
          id: "al-1",
          actor_user_id: "22222222-3333-4444-5555-666666666666",
          actor_role_snapshot: "HR_ADMIN",
          campus_context_id: "c-sse",
          action: "UPDATE",
          entity_type: "SanctionedStrength",
          entity_id: "ss-1",
          before_state: null,
          after_state: null,
          http_method: "PATCH",
          http_path: "/sanctioned-strength/ss-1",
          status_code: 200,
          ip_address: null,
          user_agent: null,
          created_at: "2026-08-05T10:00:00Z",
        },
      ];
      mockedListAuditLogs.mockResolvedValue(entries);
      renderDrawer();

      await userEvent.click(await screen.findByRole("tab", { name: "Audit Log" }));

      await waitFor(() =>
        expect(mockedListAuditLogs).toHaveBeenCalledWith({ entityType: "SanctionedStrength", entityId: "ss-1" }),
      );
      expect(await screen.findByText("UPDATE")).toBeInTheDocument();
      expect(screen.getByText("22222222")).toBeInTheDocument();
    });
  });
});
