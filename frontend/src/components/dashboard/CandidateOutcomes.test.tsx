import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { CandidateOutcomes, type OutcomeRow } from "@/components/dashboard/CandidateOutcomes";
import { SHEET_FILTER_NOTE } from "@/components/dashboard/JoiningPipelineTiles";

const APP = { selected: 2, joined: 1, waitlisted: 3, rejected: 4, withdrawn: 5 };
const SHEET = { selected: 10, joined: 20, waiting_list: 30, rejected: 40, total: 100 };

const ROWS: OutcomeRow[] = [
  { key: "teaching", label: "Teaching (Final tab)", app: APP, sheet: SHEET },
  { key: "non_teaching", label: "Non-teaching (NTS tab)", app: { ...APP, selected: 7 }, sheet: { ...SHEET, selected: 1 } },
];

function renderOutcomes(rows: OutcomeRow[], isLoading = false) {
  return render(
    <MemoryRouter>
      <CandidateOutcomes rows={rows} isLoading={isLoading} />
    </MemoryRouter>,
  );
}

function tile(rowLabel: string, tileLabel: string): HTMLElement {
  const row = screen.getByRole("region", { name: rowLabel });
  return within(row).getByText(tileLabel, { exact: true }).parentElement as HTMLElement;
}

describe("CandidateOutcomes", () => {
  it("shows sheet + app per tile with a split line, one row per category, never summed across rows", () => {
    renderOutcomes(ROWS);

    const selected = tile("Teaching (Final tab)", "Selected");
    expect(within(selected).getByText("12")).toBeInTheDocument();
    expect(within(selected).getByText("sheet 10 · app 2")).toBeInTheDocument();
    expect(within(tile("Teaching (Final tab)", "Waiting list")).getByText("33")).toBeInTheDocument();

    const ntsSelected = tile("Non-teaching (NTS tab)", "Selected");
    expect(within(ntsSelected).getByText("8")).toBeInTheDocument();
    expect(within(ntsSelected).getByText("sheet 1 · app 7")).toBeInTheDocument();
  });

  it("shows Withdrawn from the app only, with no sheet part", () => {
    renderOutcomes(ROWS);

    const withdrawn = tile("Teaching (Final tab)", "Withdrawn");
    expect(within(withdrawn).getByText("5")).toBeInTheDocument();
    expect(withdrawn.textContent).not.toMatch(/sheet/);
  });

  it("keeps the Waiting list link on every row and shows the filter note once", () => {
    renderOutcomes(ROWS);

    const links = screen.getAllByRole("link", { name: /Waiting list/ });
    expect(links).toHaveLength(2);
    links.forEach((link) => expect(link).toHaveAttribute("href", "/rejected-waiting-list"));
    expect(screen.getAllByText(SHEET_FILTER_NOTE)).toHaveLength(1);
  });

  it("shows app numbers only, with no split line and no note, when sheet data is not visible", () => {
    renderOutcomes([
      { key: "teaching", label: "Teaching", app: APP, sheet: null },
      { key: "non_teaching", label: "Non-teaching", app: APP, sheet: null },
    ]);

    expect(within(tile("Teaching", "Selected")).getByText("2")).toBeInTheDocument();
    expect(screen.queryByText(/sheet/i)).not.toBeInTheDocument();
  });

  it("renders a housekeeping row with app numbers only when it is passed", () => {
    renderOutcomes([...ROWS, { key: "housekeeping", label: "Housekeeping", app: APP, sheet: null }]);

    expect(screen.getByRole("region", { name: "Housekeeping" })).toBeInTheDocument();
    expect(within(tile("Housekeeping", "Rejected")).getByText("4")).toBeInTheDocument();
  });

  it("shows dashes and no split line while loading", () => {
    renderOutcomes(ROWS, true);

    expect(within(tile("Teaching (Final tab)", "Selected")).getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/sheet \d/)).not.toBeInTheDocument();
  });
});
