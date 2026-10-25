import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as talentPoolApi from "@/api/talentPool";
import type { TalentPoolEntryRead, TalentPoolSummary } from "@/api/types";
import { TalentPoolPage } from "@/pages/TalentPoolPage";

vi.mock("@/api/talentPool");

const mockedGetSummary = vi.mocked(talentPoolApi.getTalentPoolSummary);
const mockedListPool = vi.mocked(talentPoolApi.listTalentPool);
const mockedGetEntry = vi.mocked(talentPoolApi.getTalentPoolEntry);

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
      { department: "ECE", total: 5, eligible: 1, selected: 1, waiting: 1, rejected: 2, open: 1 },
      { department: "Nursing", total: 4, eligible: 0, selected: 1, waiting: 1, rejected: 1, open: 1 },
      { department: "Not set", total: 3, eligible: 0, selected: 0, waiting: 0, rejected: 0, open: 3 },
    ],
    department_mode: "group",
    department_count: 4,
    monthly: Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, "0")}`,
      added: i,
      selected: 0,
    })),
    undated: 2,
    breakdowns: {
      source: [
        { label: "Our Data", count: 7 },
        { label: "Mam Data", count: 7 },
        { label: "Not set", count: 5 },
      ],
      called_by: [
        { label: "Narmada", count: 2 },
        { label: "Suresh", count: 1 },
      ],
      eligibility: [
        { label: "With Ph.D", count: 9 },
        { label: "Thesis / viva stage", count: 1 },
        { label: "Pursuing Ph.D", count: 3 },
        { label: "No Ph.D", count: 2 },
        { label: "Not eligible", count: 2 },
        { label: "Not set", count: 2 },
      ],
      applied_post: [],
      call_outcomes: [],
    },
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
    department_count: 1,
    by_department: [
      { department: "Administration", total: 9, eligible: 0, selected: 2, waiting: 0, rejected: 1, open: 6 },
    ],
    breakdowns: {
      source: [{ label: "Referral", count: 9 }],
      called_by: [],
      eligibility: [],
      applied_post: [
        { label: "Lab Assistant", count: 3 },
        { label: "Office Assistant", count: 3 },
      ],
      call_outcomes: [
        { label: "Interview Scheduled", count: 1 },
        { label: "On Hold", count: 1 },
        { label: "RNR", count: 2 },
        { label: "Not Interested", count: 1 },
        { label: "No outcome", count: 1 },
      ],
    },
  });
}

function entry(overrides: Partial<TalentPoolEntryRead> = {}): TalentPoolEntryRead {
  return {
    id: "entry-1",
    source_tab: "TEACHING_FINAL",
    full_name: "Arunkumar S",
    email: "arunkumar@example.com",
    phone: "9876500000",
    dept_raw: "CSE",
    dept_group: "CSE",
    applied_post: null,
    applied_on: "2026-10-01",
    sheet_status: "Selected",
    status_from_remark: false,
    eligibility: "With Ph.D",
    eligibility_raw: "With Ph.D",
    interview_on_raw: "12/13-9-25",
    called_by: "Narmada",
    source: "Mam Data",
    remarks: "strong profile",
    resume_url: "https://drive.example.com/arunkumar.pdf",
    application_id: null,
    is_active: true,
    sheet_row_number: 42,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

function page(items: TalentPoolEntryRead[], total = items.length) {
  return { items, total, limit: 25, offset: 0 };
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
 * only, so walk up from the label instead.
 *
 * Scoped to the tiles region: after step C, "Selected" is also a table
 * column header and a chart legend entry, so an unscoped getByText is
 * genuinely ambiguous rather than merely fragile. */
function tiles() {
  return within(screen.getByTestId("talent-pool-tiles"));
}

function tileLink(label: string | RegExp): HTMLAnchorElement | null {
  return tiles().getByText(label).closest("a");
}

function departmentTable(): HTMLElement {
  return screen.getByTestId("talent-pool-department-table");
}

function registerTable(): HTMLElement {
  return screen.getByTestId("talent-pool-register-table");
}

function departmentRow(name: string): HTMLTableRowElement {
  return within(departmentTable()).getByText(name).closest("tr")!;
}

beforeEach(() => {
  vi.clearAllMocks();
  // The department toggle is remembered in localStorage, which jsdom keeps
  // for the whole file -- without this, one test's "As in sheet" choice
  // silently becomes the next test's starting state.
  try {
    localStorage.clear();
  } catch {
    // Ignored, same as the page does.
  }
  mockedListPool.mockResolvedValue(page([entry()]));
  mockedGetEntry.mockResolvedValue({ ...entry(), raw: {} });
});

describe("TalentPoolPage", () => {
  it("asks the API for the teaching tab by default and renders its tiles", async () => {
    mockedGetSummary.mockResolvedValue(summary());
    renderPage();

    // Wait on a SUB-LINE, not a label: labels render during the loading
    // skeleton as well, so waiting on one would assert against an empty tile.
    await waitFor(() => expect(screen.getByText("in the Final sheet")).toBeInTheDocument());
    expect(mockedGetSummary).toHaveBeenCalledWith("TEACHING_FINAL", "group");

    expect(tiles().getByText("Total candidates")).toBeInTheDocument();
    expect(tiles().getByText("19")).toBeInTheDocument();
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
    expect(tiles().getByText("In follow-up")).toBeInTheDocument();
    expect(tiles().getByText("4")).toBeInTheDocument();
    expect(screen.getByText("RNR 2 \u00b7 On hold 1")).toBeInTheDocument();
    expect(screen.getByText("date or note only")).toBeInTheDocument();
    // Teaching-only tiles must be gone.
    expect(tiles().queryByText("Eligible, no decision")).not.toBeInTheDocument();
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
    expect(screen.getByText("Not synced from the Google Sheet yet.")).toBeInTheDocument();
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
    for (const name of [/^edit/i, /^save/i, /^delete/i, /^remove$/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    // The register has exactly one input -- the search box. Anything else
    // would be a field someone could type a candidate's details into.
    const inputs = screen.getAllByRole("textbox");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toHaveAccessibleName("Search candidates");
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

  // --- step C: chart, department table, breakdowns -------------------------

  describe("by-department table", () => {
    it("renders every row from the response, with the teaching-only Eligible column", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      renderPage();

      await waitFor(() => expect(screen.getByText("By department")).toBeInTheDocument());

      const table = departmentTable();
      expect(within(table).getByRole("columnheader", { name: "Eligible" })).toBeInTheDocument();
      // "Pending" on teaching; NTS calls the same column "Open".
      expect(within(table).getByRole("columnheader", { name: "Pending" })).toBeInTheDocument();

      // One header row + four department rows.
      expect(within(table).getAllByRole("row")).toHaveLength(5);
      for (const name of ["CSE", "ECE", "Nursing", "Not set"]) {
        expect(within(table).getByText(name)).toBeInTheDocument();
      }
    });

    it("every department row's columns equal the summary response", async () => {
      const data = summary();
      mockedGetSummary.mockResolvedValue(data);
      renderPage();

      await waitFor(() => expect(screen.getByText("By department")).toBeInTheDocument());

      // The step C gate: what is on screen must be the response, cell for
      // cell -- not a re-derivation of it.
      for (const expected of data.by_department) {
        const row = departmentRow(expected.department);
        const cells = within(row)
          .getAllByRole("cell")
          .slice(1)
          .map((cell) => Number(cell.textContent));
        expect(cells).toEqual([
          expected.total,
          expected.eligible,
          expected.selected,
          expected.waiting,
          expected.rejected,
          expected.open,
        ]);
      }
    });

    it("the Grouped / As-in-sheet toggle re-asks the API for the raw departments", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      renderPage();

      await waitFor(() => expect(screen.getByText("By department")).toBeInTheDocument());
      expect(screen.getByRole("button", { name: "Grouped" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText(/4 groups made from Actual Dept/)).toBeInTheDocument();

      mockedGetSummary.mockResolvedValue(
        summary({
          department_mode: "raw",
          department_count: 5,
          by_department: [
            { department: "CSE", total: 6, eligible: 4, selected: 1, waiting: 1, rejected: 2, open: 2 },
            { department: "Computer Science & Engg", total: 1, eligible: 1, selected: 1, waiting: 0, rejected: 0, open: 0 },
          ],
        }),
      );
      await userEvent.click(screen.getByRole("button", { name: "As in sheet" }));

      await waitFor(() => expect(mockedGetSummary).toHaveBeenCalledWith("TEACHING_FINAL", "raw"));
      // The two CSE spellings are the whole point of the toggle.
      await waitFor(() =>
        expect(within(departmentTable()).getByText("Computer Science & Engg")).toBeInTheDocument(),
      );
      expect(screen.getByText(/5 departments exactly as typed/)).toBeInTheDocument();
    });

    it("NTS has no grouping toggle, because its two views would be identical", async () => {
      mockedGetSummary.mockResolvedValue(ntsSummary());
      renderPage("/talent-pool?tab=nts");

      await waitFor(() => expect(screen.getByText("By department")).toBeInTheDocument());
      expect(screen.queryByRole("button", { name: "Grouped" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "As in sheet" })).not.toBeInTheDocument();
      // ...and the Eligible column is teaching-only.
      expect(
        within(departmentTable()).queryByRole("columnheader", { name: "Eligible" }),
      ).not.toBeInTheDocument();
      expect(
        within(departmentTable()).getByRole("columnheader", { name: "Open" }),
      ).toBeInTheDocument();
    });

    it("clicking a department row sets the register's department filter", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      renderPage();

      await waitFor(() => expect(screen.getByText("By department")).toBeInTheDocument());
      await userEvent.click(within(departmentTable()).getByText("ECE"));

      // The filter is URL state, and it carries the mode the table was
      // grouped by -- "CSE" grouped and "CSE" as-typed are different counts.
      await waitFor(() => {
        const link = tileLink("Selected")!;
        expect(link.getAttribute("href")).toContain("department=ECE");
        expect(link.getAttribute("href")).toContain("dept_mode=group");
      });
    });

    it("a focused row responds to Enter, since a table row cannot be an anchor", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      renderPage();

      await waitFor(() => expect(screen.getByText("By department")).toBeInTheDocument());
      const row = departmentRow("Nursing");
      row.focus();
      await userEvent.keyboard("{Enter}");

      await waitFor(() =>
        expect(tileLink("Selected")!.getAttribute("href")).toContain("department=Nursing"),
      );
    });
  });

  describe("candidates per month", () => {
    it("reports the undated rows under the chart rather than hiding them", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      renderPage();

      await waitFor(() =>
        expect(screen.getByText(/2 rows have no readable date/)).toBeInTheDocument(),
      );
      expect(screen.getByText(/Dates come from Applied Date/)).toBeInTheDocument();
      expect(screen.getByTestId("talent-pool-monthly-chart")).toBeInTheDocument();
    });

    it("says nothing about undated rows when there are none", async () => {
      mockedGetSummary.mockResolvedValue(summary({ undated: 0 }));
      renderPage();

      await waitFor(() => expect(screen.getByText(/Dates come from Applied Date/)).toBeInTheDocument());
      expect(screen.queryByText(/no readable date/)).not.toBeInTheDocument();
    });

    it("names the NTS date columns, which are not the teaching ones", async () => {
      mockedGetSummary.mockResolvedValue(ntsSummary());
      renderPage("/talent-pool?tab=nts");

      await waitFor(() =>
        expect(screen.getByText(/Call \/ Mail Sent Date, or the interview date/)).toBeInTheDocument(),
      );
      expect(screen.queryByText(/Dates come from Applied Date/)).not.toBeInTheDocument();
    });

    it("renders a legend naming both series", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      renderPage();

      await waitFor(() => expect(screen.getByText("Added")).toBeInTheDocument());
      // "Selected" is also a tile label, so scope to the chart's own legend.
      expect(screen.getAllByText("Selected").length).toBeGreaterThan(1);
    });
  });

  describe("breakdown panels", () => {
    it("shows the teaching three, with eligibility in its fixed order", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      renderPage();

      await waitFor(() => expect(screen.getByText("PhD / eligibility")).toBeInTheDocument());
      expect(screen.getByText("Data source")).toBeInTheDocument();
      expect(screen.getByText("Interviews called by")).toBeInTheDocument();
      expect(screen.getByText("Eligible = With Ph.D.")).toBeInTheDocument();

      // Rendered in the API's order, not re-sorted by size -- "Not set" has
      // the same count as "No Ph.D" and "Not eligible" but must stay last.
      const panel = screen.getByText("PhD / eligibility").closest("div")!.parentElement!;
      const labels = within(panel)
        .getAllByRole("listitem")
        .map((item) => item.textContent?.replace(/\d+$/, "").trim());
      expect(labels).toEqual([
        "With Ph.D",
        "Thesis / viva stage",
        "Pursuing Ph.D",
        "No Ph.D",
        "Not eligible",
        "Not set",
      ]);
    });

    it("shows the non-teaching three instead", async () => {
      mockedGetSummary.mockResolvedValue(ntsSummary());
      renderPage("/talent-pool?tab=nts");

      await waitFor(() => expect(screen.getByText("Reference source")).toBeInTheDocument());
      // "Applied post" is also a register column header now, so name the
      // heading specifically rather than matching any text.
      expect(screen.getByRole("heading", { name: "Applied post" })).toBeInTheDocument();
      expect(screen.getByText("Call outcomes")).toBeInTheDocument();
      expect(screen.queryByText("PhD / eligibility")).not.toBeInTheDocument();
      expect(screen.queryByText("Interviews called by")).not.toBeInTheDocument();
    });

    it("an all-zero panel says so instead of drawing empty bars", async () => {
      mockedGetSummary.mockResolvedValue(
        summary({
          breakdowns: {
            ...summary().breakdowns,
            called_by: [],
          },
        }),
      );
      renderPage();

      await waitFor(() => expect(screen.getByText("Interviews called by")).toBeInTheDocument());
      expect(
        screen.getByText("No interviewer recorded against any candidate yet."),
      ).toBeInTheDocument();
    });
  });

  describe("remembering the department toggle", () => {
    it("remembers As-in-sheet for the next visit, with no dept_mode in the URL", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      const first = renderPage();

      await waitFor(() => expect(screen.getByText("By department")).toBeInTheDocument());
      mockedGetSummary.mockResolvedValue(summary({ department_mode: "raw", department_count: 5 }));
      await userEvent.click(screen.getByRole("button", { name: "As in sheet" }));
      await waitFor(() => expect(mockedGetSummary).toHaveBeenCalledWith("TEACHING_FINAL", "raw"));
      first.unmount();

      // A fresh mount with a bare URL -- the choice has to come from storage.
      mockedGetSummary.mockClear();
      renderPage("/talent-pool");
      await waitFor(() => expect(mockedGetSummary).toHaveBeenCalledWith("TEACHING_FINAL", "raw"));
    });

    it("lets the URL win over the remembered choice, so a shared link opens what it says", async () => {
      try {
        localStorage.setItem("talent-pool.dept-mode", "raw");
      } catch {
        // Ignored.
      }
      mockedGetSummary.mockResolvedValue(summary());
      renderPage("/talent-pool?dept_mode=group");

      await waitFor(() => expect(mockedGetSummary).toHaveBeenCalledWith("TEACHING_FINAL", "group"));
    });

    it("still renders when localStorage throws, which it does in a private window", async () => {
      const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("storage is blocked");
      });
      mockedGetSummary.mockResolvedValue(summary());
      renderPage();

      await waitFor(() => expect(screen.getByText("By department")).toBeInTheDocument());
      expect(mockedGetSummary).toHaveBeenCalledWith("TEACHING_FINAL", "group");
      getItem.mockRestore();
    });
  });

  describe("not claiming a sync that has not happened", () => {
    it("says where the numbers did NOT come from when rows exist but no sync has run", async () => {
      // The case that misled a real reader: seeded or imported rows with no
      // sync history. Saying "Synced from Google Sheet" above them, even
      // followed by "never synced", reads as a working sync at a glance.
      mockedGetSummary.mockResolvedValue(
        summary({ last_sync_at: null, sheet_last_update: null, last_sync_counts: null }),
      );
      renderPage();

      await waitFor(() => expect(screen.getByText("in the Final sheet")).toBeInTheDocument());
      expect(
        screen.getByText(/these numbers are whatever is already in this database, not the sheet/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/^Synced from Google Sheet/)).not.toBeInTheDocument();
      // And it is not stale either -- nothing has synced to be stale.
      expect(screen.queryByText(/hasn't synced since/)).not.toBeInTheDocument();
    });

    it("only says Synced from Google Sheet once a sync has actually run", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      renderPage();

      await waitFor(() => expect(screen.getByText(/Synced from Google Sheet/)).toBeInTheDocument());
      expect(screen.queryByText(/not the sheet/)).not.toBeInTheDocument();
    });
  });

  // --- step D: the register and the entry sheet ----------------------------

  describe("candidate register", () => {
    it("renders the teaching columns and the row's own values", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      mockedListPool.mockResolvedValue(page([entry()]));
      renderPage();

      // Wait for a ROW, not the section heading: the heading is static and
      // renders before the list query resolves.
      await waitFor(() => expect(screen.getByText("Arunkumar S")).toBeInTheDocument());

      const table = registerTable();
      for (const header of ["Name", "Department", "Applied", "Eligibility", "Status", "Interview", "Called by", "Resume"]) {
        expect(within(table).getByRole("columnheader", { name: header })).toBeInTheDocument();
      }
      expect(within(table).getByText("Arunkumar S")).toBeInTheDocument();
      expect(within(table).getByText("arunkumar@example.com")).toBeInTheDocument();
      expect(within(table).getByText("12/13-9-25")).toBeInTheDocument();
      expect(screen.getByText("1 candidate")).toBeInTheDocument();
    });

    it("renders the non-teaching columns instead, which are a different six", async () => {
      mockedGetSummary.mockResolvedValue(ntsSummary());
      mockedListPool.mockResolvedValue(
        page([
          entry({
            source_tab: "NTS",
            full_name: "Ramesh K",
            applied_post: "Lab Assistant",
            sheet_status: "RNR",
            status_from_remark: true,
            eligibility: null,
            remarks: "no response twice",
          }),
        ]),
      );
      renderPage("/talent-pool?tab=nts");

      await waitFor(() => expect(screen.getByText("Ramesh K")).toBeInTheDocument());
      const table = registerTable();
      expect(within(table).getByRole("columnheader", { name: "Applied post" })).toBeInTheDocument();
      expect(within(table).getByRole("columnheader", { name: "Remarks" })).toBeInTheDocument();
      expect(within(table).queryByRole("columnheader", { name: "Eligibility" })).not.toBeInTheDocument();
      // A status read out of a free-text remark says so, so a reader can
      // tell a recorded decision from an inferred one.
      expect(within(table).getByText("from remark")).toBeInTheDocument();
    });

    it("shows the raw department under the group only when they differ", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      mockedListPool.mockResolvedValue(
        page([
          entry({ id: "same", full_name: "Same Spelling", dept_raw: "CSE", dept_group: "CSE" }),
          entry({ id: "diff", full_name: "Other Spelling", dept_raw: "Computer Science & Engg", dept_group: "CSE" }),
        ]),
      );
      renderPage();

      await waitFor(() => expect(screen.getByText("Other Spelling")).toBeInTheDocument());
      const table = registerTable();
      expect(within(table).getByText("Computer Science & Engg")).toBeInTheDocument();
      // "CSE" appears once per row as the group; the identical raw spelling
      // is not repeated beneath it.
      expect(within(table).getAllByText("CSE")).toHaveLength(2);
    });

    it("offers a resume link only for an https URL, since the cell often holds a note", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      mockedListPool.mockResolvedValue(
        page([
          entry({ id: "link", full_name: "Has Link" }),
          entry({ id: "note", full_name: "Has Note", resume_url: "sent by whatsapp" }),
        ]),
      );
      renderPage();

      await waitFor(() => expect(screen.getByText("Has Note")).toBeInTheDocument());
      const links = within(registerTable()).getAllByRole("link", { name: /Open/ });
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAttribute("href", "https://drive.example.com/arunkumar.pdf");
      expect(links[0]).toHaveAttribute("rel", expect.stringContaining("noopener"));
    });

    it("badges a row that is no longer in the sheet", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      mockedListPool.mockResolvedValue(page([entry({ is_active: false, application_id: "app-1" })]));
      renderPage();

      await waitFor(() => expect(screen.getByText("Removed from sheet")).toBeInTheDocument());
      expect(screen.getByText("In pipeline")).toBeInTheDocument();
    });
  });

  describe("register filters", () => {
    it("asks the API with every filter the URL carries", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      renderPage(
        "/talent-pool?status=Rejected&department=CSE&eligibility=Pursuing+Ph.D&include_inactive=true",
      );

      await waitFor(() =>
        expect(mockedListPool).toHaveBeenCalledWith(
          expect.objectContaining({
            source_tab: "TEACHING_FINAL",
            sheet_status: "Rejected",
            department: "CSE",
            eligibility: "Pursuing Ph.D",
            include_inactive: true,
            limit: 25,
            offset: 0,
          }),
        ),
      );
    });

    it("debounces the search instead of firing a request per keystroke", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      renderPage();
      await waitFor(() => expect(screen.getByText("Candidate register")).toBeInTheDocument());

      mockedListPool.mockClear();
      await userEvent.type(screen.getByLabelText("Search candidates"), "meena");

      await waitFor(() =>
        expect(mockedListPool).toHaveBeenCalledWith(expect.objectContaining({ q: "meena" })),
      );
      // Five characters, nowhere near five requests.
      expect(mockedListPool.mock.calls.length).toBeLessThan(5);
    });

    it("the removed-rows switch asks for the inactive entries too", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      renderPage();
      await waitFor(() => expect(screen.getByText("Candidate register")).toBeInTheDocument());

      await userEvent.click(screen.getByLabelText("Show removed rows"));
      await waitFor(() =>
        expect(mockedListPool).toHaveBeenCalledWith(expect.objectContaining({ include_inactive: true })),
      );
    });

    it("says so when the filters match nothing, rather than showing an empty frame", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      mockedListPool.mockResolvedValue(page([], 0));
      renderPage("/talent-pool?status=Rejected");

      await waitFor(() =>
        expect(screen.getByText("No candidates match these filters.")).toBeInTheDocument(),
      );
      expect(screen.getByText("0 candidates")).toBeInTheDocument();
    });

    it("a department row click filters the register and returns to page one", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      renderPage("/talent-pool?offset=75");
      await waitFor(() => expect(screen.getByText("Candidate register")).toBeInTheDocument());

      mockedListPool.mockClear();
      await userEvent.click(within(departmentTable()).getByText("Nursing"));

      await waitFor(() =>
        expect(mockedListPool).toHaveBeenCalledWith(
          expect.objectContaining({ department: "Nursing", offset: 0 }),
        ),
      );
    });
  });

  describe("pagination", () => {
    it("pages by 25 and asks for the next offset", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      mockedListPool.mockResolvedValue(
        page(Array.from({ length: 25 }, (_, i) => entry({ id: `e${i}`, full_name: `Candidate ${i}` })), 60),
      );
      renderPage();

      await waitFor(() => expect(screen.getByText("60 candidates")).toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: /next/i }));

      await waitFor(() =>
        expect(mockedListPool).toHaveBeenCalledWith(expect.objectContaining({ offset: 25, limit: 25 })),
      );
    });

    it("hides the pager when everything fits on one page", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      mockedListPool.mockResolvedValue(page([entry()], 1));
      renderPage();

      await waitFor(() => expect(screen.getByText("1 candidate")).toBeInTheDocument());
      expect(screen.queryByRole("button", { name: /next/i })).not.toBeInTheDocument();
    });
  });

  describe("entry sheet", () => {
    it("opens on a row click and shows every sheet column", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      mockedListPool.mockResolvedValue(page([entry()]));
      mockedGetEntry.mockResolvedValue({
        ...entry(),
        raw: { "Actual Dept": "CSE", "Applied Date": "01-10-2026", "Mam Remarks": "shortlist" },
      });
      renderPage();

      await waitFor(() => expect(screen.getByText("Arunkumar S")).toBeInTheDocument());
      await userEvent.click(within(registerTable()).getByText("Arunkumar S"));

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("Sheet row 42")).toBeInTheDocument();
      await waitFor(() => expect(within(dialog).getByText("All columns")).toBeInTheDocument());
      // A column nobody modelled is still readable, which is the whole
      // point of storing `raw`.
      await waitFor(() => expect(within(dialog).getByText("Mam Remarks")).toBeInTheDocument());
      expect(within(dialog).getByText("shortlist")).toBeInTheDocument();
    });

    it("has nothing in it that can edit the candidate", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      mockedListPool.mockResolvedValue(page([entry()]));
      renderPage();

      await waitFor(() => expect(screen.getByText("Arunkumar S")).toBeInTheDocument());
      await userEvent.click(within(registerTable()).getByText("Arunkumar S"));

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).queryAllByRole("textbox")).toHaveLength(0);
      for (const name of [/^save/i, /^edit/i, /^delete/i]) {
        expect(within(dialog).queryByRole("button", { name })).not.toBeInTheDocument();
      }
    });

    it("opens from a focused row on Enter", async () => {
      mockedGetSummary.mockResolvedValue(summary());
      mockedListPool.mockResolvedValue(page([entry()]));
      renderPage();

      await waitFor(() => expect(screen.getByText("Arunkumar S")).toBeInTheDocument());
      const row = within(registerTable()).getByText("Arunkumar S").closest("tr")!;
      row.focus();
      await userEvent.keyboard("{Enter}");

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });
  });
});
