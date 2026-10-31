import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import { ApiError } from "@/api/client";
import * as batchesApi from "@/api/selectionBatches";
import * as talentPoolApi from "@/api/talentPool";
import type { SelectionBatchDetail, TalentPoolEntryRead, TalentPoolSummary } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { TalentPoolRegister, type RegisterFilters } from "@/components/talentPool/TalentPoolRegister";

vi.mock("@/api/talentPool");
vi.mock("@/api/selectionBatches");
vi.mock("@/api/campuses");
vi.mock("@/auth/AuthContext", () => ({ useAuth: vi.fn() }));

const mockedUseAuth = vi.mocked(authContext.useAuth);

function asRole(role: string) {
  mockedUseAuth.mockReturnValue({ user: { role } } as unknown as ReturnType<typeof authContext.useAuth>);
}

function entry(id: string, name: string, over: Partial<TalentPoolEntryRead> = {}): TalentPoolEntryRead {
  return {
    id, source_tab: "TEACHING_FINAL", full_name: name, email: null, phone: null, dept_raw: "CSE", dept_group: "CSE",
    applied_post: null, applied_on: null, sheet_status: "Selected", status_from_remark: false, eligibility: null,
    eligibility_raw: null, interview_on_raw: null, called_by: null, source: null, remarks: null, resume_url: null,
    application_id: null, is_active: true, sheet_row_number: 1, created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z", ...over,
  };
}

const summary = {
  by_status: { Selected: 3 }, by_department: [], by_eligibility: {},
} as unknown as TalentPoolSummary;

const filters = (over: Partial<RegisterFilters> = {}): RegisterFilters => ({
  q: "", status: "Selected", department: "", eligibility: "", source: "", calledBy: "", appliedPost: "",
  month: "", undecided: false, includeInactive: false, offset: 0, ...over,
});

function renderRegister(f: RegisterFilters = filters()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TalentPoolRegister
          tab="TEACHING_FINAL" deptMode="group" summary={summary} filters={f}
          onFiltersChange={vi.fn()} onOpenEntry={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  asRole("HR_ADMIN");
  vi.mocked(talentPoolApi.listTalentPool).mockResolvedValue({
    items: [entry("e1", "Asha", { applied_post: "Professor" }), entry("e2", "Bala"), entry("e3", "Chitra")],
    total: 3, limit: 25, offset: 0,
  });
  vi.mocked(batchesApi.getBatchMembership).mockResolvedValue({ e3: "SB-2026-004" });
  vi.mocked(campusesApi.listCampuses).mockResolvedValue([{ id: "c-1", code: "SSE" } as never]);
});

describe("TalentPoolRegister batch selection", () => {
  it("shows checkboxes for Selected + an allowed role", async () => {
    renderRegister();
    expect(await screen.findByRole("checkbox", { name: "Select Asha" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select all on this page" })).toBeInTheDocument();
  });

  it("shows none when the status filter is not Selected", async () => {
    renderRegister(filters({ status: "Pending" }));
    await screen.findByText("Asha");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(batchesApi.getBatchMembership).not.toHaveBeenCalled();
  });

  it("shows none for a role outside the three", async () => {
    asRole("MANAGEMENT");
    renderRegister();
    await screen.findByText("Asha");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("replaces the checkbox with an In-batch badge", async () => {
    renderRegister();
    expect(await screen.findByText("In SB-2026-004")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Select Chitra" })).not.toBeInTheDocument();
    expect(batchesApi.getBatchMembership).toHaveBeenCalledWith(["e1", "e2", "e3"]);
  });

  it("select-all skips people already in a batch and submits the right payload", async () => {
    const user = userEvent.setup();
    const created = { id: "b-1", batch_no: "SB-2026-005", member_count: 2 } as SelectionBatchDetail;
    vi.mocked(batchesApi.createSelectionBatch).mockResolvedValue(created);
    renderRegister();

    await screen.findByText("In SB-2026-004");
    await user.click(screen.getByRole("checkbox", { name: "Select all on this page" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Send to University" }));
    const dialog = await screen.findByRole("dialog");
    // Designation is prefilled from applied_post.
    expect(within(dialog).getByLabelText("Designation for Asha")).toHaveValue("Professor");
    await user.type(within(dialog).getByLabelText("Proposed salary for Bala"), "55000");
    await user.type(within(dialog).getByLabelText(/Note/), "First list");
    await user.click(within(dialog).getByRole("button", { name: "Send to University" }));

    await waitFor(() => expect(batchesApi.createSelectionBatch).toHaveBeenCalled());
    expect(vi.mocked(batchesApi.createSelectionBatch).mock.calls[0][0]).toEqual({
      members: [
        { talent_pool_entry_id: "e1", designation: "Professor", proposed_salary: null },
        { talent_pool_entry_id: "e2", designation: null, proposed_salary: "55000" },
      ],
      campus_id: null,
      note: "First list",
    });
    const link = await screen.findByRole("link", { name: "SB-2026-005" });
    expect(link).toHaveAttribute("href", "/selection-batches/b-1");
    expect(screen.queryByText("2 selected")).not.toBeInTheDocument();
  });

  it("shows the server's 409 message and keeps the dialog open", async () => {
    const user = userEvent.setup();
    vi.mocked(batchesApi.createSelectionBatch).mockRejectedValue(new ApiError(409, "Asha is already in SB-2026-004"));
    renderRegister();

    await user.click(await screen.findByRole("checkbox", { name: "Select Asha" }));
    await user.click(screen.getByRole("button", { name: "Send to University" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Send to University" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Asha is already in SB-2026-004");
  });
});
