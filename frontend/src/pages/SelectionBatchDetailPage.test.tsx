import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as batchesApi from "@/api/selectionBatches";
import type { SelectionBatchDetail } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { SelectionBatchDetailPage } from "@/pages/SelectionBatchDetailPage";

vi.mock("@/api/selectionBatches");
vi.mock("@/auth/AuthContext", () => ({ useAuth: vi.fn() }));

function asRole(role: string) {
  vi.mocked(authContext.useAuth).mockReturnValue({ user: { role } } as unknown as ReturnType<typeof authContext.useAuth>);
}

function detail(over: Partial<SelectionBatchDetail> = {}): SelectionBatchDetail {
  return {
    id: "b-1", batch_no: "SB-2026-001", status: "SENT_TO_UNIVERSITY", campus_id: "c", campus_code: "SSE", note: null,
    sent_on: "2026-10-30", university_ref_no: null, university_approved_on: null, created_by_id: "u",
    approval_recorded_by_id: null, member_count: 1, created_at: "2026-10-30T10:00:00Z",
    members: [{
      id: "m-1", talent_pool_entry_id: "e1", full_name: "Asha Rao", designation: "Professor", department: "CSE",
      category: "TEACHING", qualification: "Ph.D", experience: "8 yrs", panel_remarks: "Strong", proposed_salary: "90000",
    }],
    ...over,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/selection-batches/b-1"]}>
        <Routes><Route path="/selection-batches/:id" element={<SelectionBatchDetailPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  asRole("HR_ADMIN");
});

describe("SelectionBatchDetailPage", () => {
  it("shows members and all four actions while sent to the University", async () => {
    vi.mocked(batchesApi.getSelectionBatch).mockResolvedValue(detail());
    renderPage();
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("90000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download Excel/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download PDF/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record University approval" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
  });

  it("hides approval and withdraw once approved, and shows the reference", async () => {
    vi.mocked(batchesApi.getSelectionBatch).mockResolvedValue(
      detail({ status: "UNIVERSITY_APPROVED", university_ref_no: "UNI/55", university_approved_on: "2026-10-31" }),
    );
    renderPage();
    expect(await screen.findByText("UNI/55")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record University approval" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download Excel/ })).toBeInTheDocument();
  });

  it("hides approval and withdraw when withdrawn", async () => {
    vi.mocked(batchesApi.getSelectionBatch).mockResolvedValue(detail({ status: "WITHDRAWN" }));
    renderPage();
    await screen.findByText("Asha Rao");
    expect(screen.queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
  });

  it("requires both fields before saving the approval", async () => {
    const user = userEvent.setup();
    vi.mocked(batchesApi.getSelectionBatch).mockResolvedValue(detail());
    vi.mocked(batchesApi.recordUniversityApproval).mockResolvedValue(detail({ status: "UNIVERSITY_APPROVED" }));
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Record University approval" }));
    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "Save approval" });
    expect(save).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Reference no."), "UNI/55");
    expect(save).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Approval date"), "2026-10-31");
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() =>
      expect(batchesApi.recordUniversityApproval).toHaveBeenCalledWith("b-1", {
        university_ref_no: "UNI/55",
        university_approved_on: "2026-10-31",
      }),
    );
  });

  it("withdraws with an optional reason after confirmation", async () => {
    const user = userEvent.setup();
    vi.mocked(batchesApi.getSelectionBatch).mockResolvedValue(detail());
    vi.mocked(batchesApi.withdrawSelectionBatch).mockResolvedValue(detail({ status: "WITHDRAWN" }));
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Withdraw" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Reason/), "Wrong list");
    await user.click(within(dialog).getByRole("button", { name: "Withdraw batch" }));
    await waitFor(() => expect(batchesApi.withdrawSelectionBatch).toHaveBeenCalledWith("b-1", "Wrong list"));
  });

  it("shows a not-allowed message to other roles", () => {
    asRole("MANAGEMENT");
    renderPage();
    expect(screen.getByText(/not allowed/i)).toBeInTheDocument();
    expect(batchesApi.getSelectionBatch).not.toHaveBeenCalled();
  });
});
