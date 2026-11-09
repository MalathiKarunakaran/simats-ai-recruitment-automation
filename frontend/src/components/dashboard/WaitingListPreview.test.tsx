import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as outcomesApi from "@/api/applicationOutcomes";
import type { DashboardPipelineExtras } from "@/api/dashboard";
import type { ApplicationOutcomeRow } from "@/api/types";
import { WaitingListPreview } from "@/components/dashboard/WaitingListPreview";

vi.mock("@/api/applicationOutcomes");

const APP_ROW = {
  application_id: "app-1",
  candidate_name: "Asha App",
  waitlist_rank: 1,
  position_title: "Assistant Professor",
  department_name: "CSE",
  campus_code: "SSE",
  vacancy_open_slots: 1,
} as ApplicationOutcomeRow;

const PREVIEW: NonNullable<DashboardPipelineExtras["talent_pool_waiting_preview"]> = {
  teaching: [{ id: "t1", full_name: "Tara Teaching", dept_raw: "ECE", applied_post: "Professor" }],
  non_teaching: [{ id: "n1", full_name: "Nila Nts", dept_raw: null, applied_post: "Lab Assistant" }],
};
const OUTCOMES: NonNullable<DashboardPipelineExtras["talent_pool_outcomes"]> = {
  teaching: { selected: 0, joined: 0, waiting_list: 180, rejected: 0, total: 0 },
  non_teaching: { selected: 0, joined: 0, waiting_list: 36, rejected: 0, total: 0 },
};

function mockRows(items: ApplicationOutcomeRow[]) {
  vi.mocked(outcomesApi.listWaitingList).mockResolvedValue({
    items,
    total: items.length,
    limit: 3,
    offset: 0,
    category_counts: { TEACHING: 0, NON_TEACHING: 0, HOUSEKEEPING: 0, ALL: items.length },
  });
}

function renderPreview(props: Partial<React.ComponentProps<typeof WaitingListPreview>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <WaitingListPreview canPromote {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => mockRows([APP_ROW]));

describe("WaitingListPreview", () => {
  it("lists app rows with Promote, then labelled sheet groups without Promote, in Teaching then Non-teaching order", async () => {
    renderPreview({ sheetPreview: PREVIEW, sheetOutcomes: OUTCOMES });

    expect(await screen.findByRole("link", { name: "Asha App" })).toHaveAttribute("href", "/applications/app-1");
    expect(screen.getAllByRole("button", { name: "Promote" })).toHaveLength(1);

    const teaching = screen.getByRole("group", { name: "Teaching (Final tab)" });
    const nts = screen.getByRole("group", { name: "Non-teaching (NTS tab)" });
    expect(teaching.compareDocumentPosition(nts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(teaching).getByText("180 waiting")).toBeInTheDocument();
    expect(within(nts).getByText("36 waiting")).toBeInTheDocument();
    expect(within(teaching).queryByRole("button")).not.toBeInTheDocument();

    expect(within(teaching).getByRole("link", { name: "Tara Teaching" })).toHaveAttribute(
      "href",
      "/talent-pool?status=Waiting+List#register",
    );
    expect(within(nts).getByRole("link", { name: "Nila Nts" })).toHaveAttribute(
      "href",
      "/talent-pool?tab=nts&status=Waiting+List#register",
    );
    // See all keeps the app total only.
    expect(screen.getByRole("link", { name: "See all (1)" })).toBeInTheDocument();
  });

  it("shows the sheet groups even when no application is waiting", async () => {
    mockRows([]);
    renderPreview({ sheetPreview: PREVIEW, sheetOutcomes: OUTCOMES });

    expect(await screen.findByRole("group", { name: "Teaching (Final tab)" })).toBeInTheDocument();
    expect(screen.queryByText("Nobody is on the waiting list.")).not.toBeInTheDocument();
  });

  it("shows only app rows and no groups when sheet data is null", async () => {
    renderPreview({ sheetPreview: null, sheetOutcomes: null });

    await screen.findByRole("link", { name: "Asha App" });
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("says nobody is waiting when there are neither app nor sheet rows", async () => {
    mockRows([]);
    renderPreview({ sheetPreview: { teaching: [], non_teaching: [] }, sheetOutcomes: OUTCOMES });

    expect(await screen.findByText("Nobody is on the waiting list.")).toBeInTheDocument();
  });
});
