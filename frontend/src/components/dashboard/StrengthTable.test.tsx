import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { DashboardStrengthTableRow } from "@/api/types";
import { StrengthTable } from "@/components/dashboard/StrengthTable";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

function row(overrides: Partial<DashboardStrengthTableRow> = {}): DashboardStrengthTableRow {
  return {
    sanctioned_strength_id: "ss-1",
    campus_code: "SSE",
    department_id: "d-cse",
    department_name: "CSE",
    designation_id: "des-ap",
    designation_name: "Assistant Professor",
    category: "TEACHING",
    location_id: "loc-1",
    location_name: "Circular Building",
    approved: 10,
    working: 4,
    vacancy: 6,
    filled_pct: 40,
    status: "VACANCY_RECRUITMENT_REQUIRED",
    ...overrides,
  };
}

function renderTable(rows: DashboardStrengthTableRow[], isLoading = false) {
  return render(
    <MemoryRouter>
      <StrengthTable rows={rows} isLoading={isLoading} />
    </MemoryRouter>,
  );
}

describe("StrengthTable", () => {
  it("renders every column the brief names", async () => {
    renderTable([row()]);

    for (const header of [
      "Campus",
      "Department",
      "Designation",
      "Category",
      "Location",
      "Sanctioned",
      "Working",
      "Vacancy",
      "Filled %",
      "Recruitment Status",
    ]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }

    const dataRow = screen.getByTestId("strength-table-row");
    expect(within(dataRow).getByText("SSE")).toBeInTheDocument();
    expect(within(dataRow).getByText("CSE")).toBeInTheDocument();
    expect(within(dataRow).getByText("Circular Building")).toBeInTheDocument();
    expect(within(dataRow).getByText("40%")).toBeInTheDocument();
  });

  it("renders the server's figures verbatim rather than recomputing them", () => {
    // Two surfaces deriving the same number independently is how they drift.
    // If this component ever started computing vacancy = approved - working,
    // this deliberately inconsistent row would expose it.
    renderTable([row({ approved: 10, working: 4, vacancy: 99, filled_pct: 12.5 })]);

    const dataRow = screen.getByTestId("strength-table-row");
    expect(within(dataRow).getByText("99")).toBeInTheDocument();
    expect(within(dataRow).getByText("12.5%")).toBeInTheDocument();
  });

  it("shows a negative vacancy as-is for an overstaffed row", () => {
    renderTable([row({ vacancy: -3, status: "OVERSTAFFED" })]);

    const dataRow = screen.getByTestId("strength-table-row");
    expect(within(dataRow).getByText("-3")).toBeInTheDocument();
    expect(within(dataRow).getByText("Overstaffed")).toBeInTheDocument();
  });

  it("badges each status using the shared vocabulary", () => {
    renderTable([
      row({ sanctioned_strength_id: "ss-1", status: "FULLY_STAFFED" }),
      row({ sanctioned_strength_id: "ss-2", status: "VACANCY_RECRUITMENT_REQUIRED" }),
      row({ sanctioned_strength_id: "ss-3", status: "APPROVAL_PENDING" }),
    ]);

    expect(screen.getByText("Fully Staffed")).toBeInTheDocument();
    expect(screen.getByText("Vacancy/Recruitment Required")).toBeInTheDocument();
    expect(screen.getByText("Approval Pending")).toBeInTheDocument();
  });

  it("renders an em dash, not a blank cell, when Filled % is null", () => {
    // null means "nothing sanctioned" -- 0% would read as "nothing filled".
    renderTable([row({ approved: 0, filled_pct: null })]);

    const dataRow = screen.getByTestId("strength-table-row");
    expect(within(dataRow).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("opens the sanctioned strength record on row click", async () => {
    renderTable([row({ sanctioned_strength_id: "ss-42" })]);

    await userEvent.click(screen.getByTestId("strength-table-row"));

    expect(mockNavigate).toHaveBeenCalledWith("/sanctioned-strength?highlight=ss-42");
  });

  it("opens on Enter too, so the drill-down is reachable without a mouse", async () => {
    mockNavigate.mockClear();
    renderTable([row({ sanctioned_strength_id: "ss-7" })]);

    const dataRow = screen.getByTestId("strength-table-row");
    dataRow.focus();
    await userEvent.keyboard("{Enter}");

    expect(mockNavigate).toHaveBeenCalledWith("/sanctioned-strength?highlight=ss-7");
  });

  it("leaves a Housekeeping row non-interactive, since it has no single record to open", async () => {
    mockNavigate.mockClear();
    // Housekeeping is Location-grained and aggregates several sanctioned
    // rows, so sanctioned_strength_id is null. Linking somewhere would be
    // misleading rather than helpful.
    renderTable([row({ sanctioned_strength_id: null, category: "HOUSEKEEPING", location_id: "loc-9" })]);

    const dataRow = screen.getByTestId("strength-table-row");
    expect(dataRow).not.toHaveAttribute("role", "button");
    await userEvent.click(dataRow);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("keys Housekeeping rows without an id, so several can coexist", () => {
    renderTable([
      row({ sanctioned_strength_id: null, category: "HOUSEKEEPING", location_id: "loc-1" }),
      row({ sanctioned_strength_id: null, category: "HOUSEKEEPING", location_id: "loc-2" }),
    ]);

    expect(screen.getAllByTestId("strength-table-row")).toHaveLength(2);
  });

  it("shows 0 rather than a large empty card when nothing matches", () => {
    renderTable([]);

    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("No sanctioned positions match these filters.")).toBeInTheDocument();
  });

  it("shows a loading placeholder while fetching", () => {
    renderTable([], true);

    expect(screen.getByRole("status", { name: "Loading strength table" })).toBeInTheDocument();
  });
});
