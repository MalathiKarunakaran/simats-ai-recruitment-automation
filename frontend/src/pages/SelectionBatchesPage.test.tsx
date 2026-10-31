import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as batchesApi from "@/api/selectionBatches";
import type { SelectionBatch } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { SelectionBatchesPage } from "@/pages/SelectionBatchesPage";

vi.mock("@/api/selectionBatches");
vi.mock("@/auth/AuthContext", () => ({ useAuth: vi.fn() }));

function asRole(role: string) {
  vi.mocked(authContext.useAuth).mockReturnValue({ user: { role } } as unknown as ReturnType<typeof authContext.useAuth>);
}

const batch: SelectionBatch = {
  id: "b-1", batch_no: "SB-2026-001", status: "SENT_TO_UNIVERSITY", campus_id: "c", campus_code: "SSE", note: null,
  sent_on: "2026-10-30", university_ref_no: null, university_approved_on: null, created_by_id: "u",
  approval_recorded_by_id: null, member_count: 3, created_at: "2026-10-30T10:00:00Z",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><SelectionBatchesPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("SelectionBatchesPage", () => {
  it("lists batches with link, people, status and campus", async () => {
    asRole("RECRUITMENT_COORDINATOR");
    vi.mocked(batchesApi.listSelectionBatches).mockResolvedValue({ items: [batch], total: 1, limit: 25, offset: 0 });
    renderPage();
    const link = await screen.findByRole("link", { name: "SB-2026-001" });
    expect(link).toHaveAttribute("href", "/selection-batches/b-1");
    expect(screen.getByText("Sent to University")).toBeInTheDocument();
    expect(screen.getByText("SSE")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows a not-allowed message and loads nothing for other roles", () => {
    asRole("CAMPUS_HOD");
    renderPage();
    expect(screen.getByText(/not allowed/i)).toBeInTheDocument();
    expect(batchesApi.listSelectionBatches).not.toHaveBeenCalled();
  });
});
