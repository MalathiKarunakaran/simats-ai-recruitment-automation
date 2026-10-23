import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as talentPoolApi from "@/api/talentPool";
import type { TalentPoolSummary } from "@/api/types";
import { TalentPoolPage } from "@/pages/TalentPoolPage";

vi.mock("@/api/talentPool");

const mockedGetSummary = vi.mocked(talentPoolApi.getTalentPoolSummary);

function summary(overrides: Partial<TalentPoolSummary> = {}): TalentPoolSummary {
  return {
    source_tab: "TEACHING_FINAL",
    total: 19,
    by_status: { Selected: 4, "Waiting List": 3, Rejected: 5, Pending: 7 },
    by_eligibility: {
      "With Ph.D": 9,
      "Thesis / viva stage": 1,
      "Pursuing Ph.D": 3,
      "No Ph.D": 2,
      "Not eligible": 2,
      "Not set": 2,
    },
    eligible_definition: ["With Ph.D"],
    eligible_pending: 3,
    by_department: [
      { department: "CSE", total: 7, eligible: 5, selected: 2, waiting: 1, rejected: 2, open: 2 },
    ],
    department_mode: "group",
    department_count: 4,
    monthly: Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, "0")}`,
      added: i,
      selected: 0,
    })),
    undated: 2,
    breakdowns: { source: [], called_by: [], eligibility: [], applied_post: [], call_outcomes: [] },
    last_sync_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    sheet_last_update: "14-10-2026, 04.51 pm",
    last_sync_counts: { inserted: 12, updated: 30, unchanged: 7700, deactivated: 0 },
    ...overrides,
  };
}

function ntsSummary(): TalentPoolSummary {
  return summary({
    source_tab: "NTS",
    total: 9,
    by_status: {
      Selected: 2,
      Rejected: 1,
      RNR: 2,
      "On Hold": 1,
      "Interview Scheduled": 1,
      "Not Interested": 1,
      "No outcome": 1,
    },
    by_eligibility: {},
    eligible_pending: 0,
  });
}

function renderPage(initialPath = "/talent-pool") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <TalentPoolPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The tiles are anchors, so a tile's "click action" is asserted as its
 * href. Finding the <a> by its accessible name would match the label text
 * only, so walk up from the label instead. */
function tileLink(label: string | RegExp): HTMLAnchorElement | null {
  const title = screen.getByText(label);
  return title.closest("a");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TalentPoolPage", () => {
  it("asks the API for the teaching tab by default and renders its tiles", async () => {
    mockedGetSummary.mockResolvedValue(summary());
    renderPage();

    // Wait on a SUB-LINE, not a label: labels render during the loading
    // skeleton as well, so waiting on one would assert against an empty tile.
    await waitFor(() => expect(screen.getByText("in the Final sheet")).toBeInTheDocument());
    expect(mockedGetSummary).toHaveBeenCalledWith("TEACHING_FINAL", "group");

    expect(screen.getByText("Total candidates")).toBeInTheDocument();
    expect(screen.getByText("19")).toBeInTheDocument();
    // Selected = 4 of 12 decided (4 + 3 + 5) -> 33%.
    expect(screen.getByText("33% of interviewed")).toBeInTheDocument();
    expect(screen.getByText("no decision recorded")).toBeInTheDocument();
  });

  it("labels the eligible tile from the API's own definition, not a hardcoded string", async () => {
    mockedGetSummary.mockResolvedValue(summary());
    renderPage();

    // 9 With Ph.D, of which 1 is at thesis/viva -- reported apart because
    // thesis/viva is deliberately NOT in eligible_definition.
    await waitFor(() =>
      expect(screen.getByText("+1 at thesis / viva stage")).toBeInTheDocument(),
    );
    expect(screen.getByText("Eligible (With Ph.D)")).toBeInTheDocument();
  });

  it("clicking \"Eligible, no decision\" sets BOTH register filters", async () => {
    mockedGetSummary.mockResolvedValue(summary());
    renderPage();

    await waitFor(() => expect(screen.getByText("in the Final sheet")).toBeInTheDocument());
    const link = tileLink("Eligible, no decision");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toContain("eligibility=With+Ph.D");
    expect(link!.getAttribute("href")).toContain("status=Pending");
  });

  it("the plain status tiles filter by status alone", async () => {
    mockedGetSummary.mockResolvedValue(summary());
    renderPage();

    await waitFor(() => expect(screen.getByText("in the Final sheet")).toBeInTheDocument());
    expect(tileLink("Selected")!.getAttribute("href")).toContain("status=Selected");
    expect(tileLink("Rejected")!.getAttribute("href")).toContain("status=Rejected");
    // "Total candidates" has no click action, so it is not a link at all.
    expect(tileLink("Total candidates")).toBeNull();
  });

  it("the tab toggle switches source_tab and clears the register filters", async () => {
    mockedGetSummary.mockResolvedValue(summary());
    renderPage("/talent-pool?status=Selected&eligibility=With+Ph.D");

    await waitFor(() => expect(screen.getByText("in the Final sheet")).toBeInTheDocument());

    mockedGetSummary.mockResolvedValue(ntsSummary());
    await userEvent.click(screen.getByRole("tab", { name: "Non-teaching" }));

    await waitFor(() => expect(mockedGetSummary).toHaveBeenCalledWith("NTS", "group"));
    // Filters are URL state, and switching tab rebuilds the URL from
    // scratch -- a status from the Final sheet often does not exist on NTS,
    // so carrying it across would silently empty the register.
    await waitFor(() => {
      expect(tileLink("Selected")!.getAttribute("href")).not.toContain("eligibility");
    });
  });

  it("renders the non-teaching tiles, which are a different seven", async () => {
    mockedGetSummary.mockResolvedValue(ntsSummary());
    renderPage("/talent-pool?tab=nts");

    await waitFor(() => expect(screen.getByText("in the NTS sheet")).toBeInTheDocument());
    expect(mockedGetSummary).toHaveBeenCalledWith("NTS", "group");
    // RNR 2 + On Hold 1 + Interview Scheduled 1
    expect(screen.getByText("In follow-up")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("RNR 2 \u00b7 On hold 1")).toBeInTheDocument();
    expect(screen.getByText("date or note only")).toBeInTheDocument();
    // Teaching-only tiles must be gone.
    expect(screen.queryByText("Eligible, no decision")).not.toBeInTheDocument();
  });

  it("shows the freshness line from the summary", async () => {
    mockedGetSummary.mockResolvedValue(summary());
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/Synced from Google Sheet/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/sheet last updated 14-10-2026, 04\.51 pm/)).toBeInTheDocument();
  });

  it("warns when the last sync is 2 hours old, and not when it is 5 minutes old", async () => {
    mockedGetSummary.mockResolvedValue(
      summary({ last_sync_at: new Date(Date.now() - 120 * 60_000).toISOString() }),
    );
    const stale = renderPage();
    await waitFor(() =>
      expect(screen.getByText(/hasn't synced since/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/n8n Talent Pool sync workflow/)).toBeInTheDocument();
    stale.unmount();

    mockedGetSummary.mockResolvedValue(summary());
    renderPage();
    await waitFor(() => expect(screen.getByText("in the Final sheet")).toBeInTheDocument());
    expect(screen.queryByText(/hasn't synced since/)).not.toBeInTheDocument();
  });

  it("treats a pool that has never synced as never synced, not as infinitely stale", async () => {
    mockedGetSummary.mockResolvedValue(
      summary({ total: 0, last_sync_at: null, sheet_last_update: null, last_sync_counts: null }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText("No candidates synced yet")).toBeInTheDocument());
    expect(screen.getByText(/never synced/)).toBeInTheDocument();
    // The stale banner is about a sync that happened too long ago; one that
    // never happened is a different message.
    expect(screen.queryByText(/hasn't synced since/)).not.toBeInTheDocument();
  });

  it("renders the empty state when the tab has no candidates", async () => {
    mockedGetSummary.mockResolvedValue(summary({ total: 0 }));
    renderPage();

    await waitFor(() => expect(screen.getByText("No candidates synced yet")).toBeInTheDocument());
    expect(screen.getByText(/every 15 minutes once the n8n workflow is running/)).toBeInTheDocument();
    expect(screen.queryByText("in the Final sheet")).not.toBeInTheDocument();
  });

  it("shows the API error with a Retry that re-fetches", async () => {
    mockedGetSummary.mockRejectedValueOnce(new Error("Talent pool is unavailable"));
    renderPage();

    await waitFor(() => expect(screen.getByText("Talent pool is unavailable")).toBeInTheDocument());

    mockedGetSummary.mockResolvedValue(summary());
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("in the Final sheet")).toBeInTheDocument());
  });

  it("Refresh re-reads our own table and does not claim to sync the sheet", async () => {
    mockedGetSummary.mockResolvedValue(summary());
    renderPage();

    await waitFor(() => expect(screen.getByText("in the Final sheet")).toBeInTheDocument());
    const before = mockedGetSummary.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    await waitFor(() => expect(mockedGetSummary.mock.calls.length).toBeGreaterThan(before));
    // Nothing on this page triggers a sync; the n8n workflow owns that.
    expect(screen.queryByRole("button", { name: /Sync now/i })).not.toBeInTheDocument();
  });

  it("has no control that can edit a pool entry", async () => {
    mockedGetSummary.mockResolvedValue(summary());
    renderPage();

    await waitFor(() => expect(screen.getByText("in the Final sheet")).toBeInTheDocument());
    for (const name of [/edit/i, /save/i, /delete/i, /remove/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("keeps the tab in the URL so a link opens the same view", async () => {
    mockedGetSummary.mockResolvedValue(ntsSummary());
    renderPage("/talent-pool?tab=nts");

    await waitFor(() => expect(screen.getByRole("tab", { name: "Non-teaching" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("tab", { name: "Teaching" })).toHaveAttribute("aria-selected", "false");
  });

  it("renders skeleton tiles while loading rather than collapsing the row", async () => {
    let resolve!: (value: TalentPoolSummary) => void;
    mockedGetSummary.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderPage();

    const loading = await screen.findAllByRole("status");
    expect(loading.length).toBeGreaterThan(0);
    expect(within(loading[0]).queryByText("19")).not.toBeInTheDocument();

    resolve(summary());
    await waitFor(() => expect(screen.getByText("in the Final sheet")).toBeInTheDocument());
  });
});
