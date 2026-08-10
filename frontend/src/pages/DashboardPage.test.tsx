import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as dashboardApi from "@/api/dashboard";
import type { CategoryBreakdownRow, DashboardKpis } from "@/api/types";
import { CampusProvider } from "@/campus/CampusContext";
import { DashboardPage } from "@/pages/DashboardPage";

vi.mock("@/api/dashboard");

const mockedGetDashboardKpis = vi.mocked(dashboardApi.getDashboardKpis);

function renderWithProviders() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <CampusProvider>
          <DashboardPage />
        </CampusProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const REAL_SHAPE_BREAKDOWN: CategoryBreakdownRow[] = [
  { role_category: "TEACHING", applications: 12, open_positions: 3, hires: 2 },
  { role_category: "NON_TEACHING", applications: 20, open_positions: 4, hires: 1 },
  { role_category: "HOUSEKEEPING", applications: 5, open_positions: 1, hires: 0 },
];

// Mirrors the real /dashboard/kpis response: total_applications (and the
// rest of the top-line fields) genuinely narrow when role_category is
// passed, but category_wise_breakdown is returned identically regardless of
// that same param (app/services/reporting.py::get_dashboard_kpis's
// documented behavior) -- the mock reproduces that asymmetry deliberately so
// tests can catch a regression that accidentally filters the split card too.
function mockKpis(overrides: Partial<DashboardKpis> = {}): void {
  mockedGetDashboardKpis.mockImplementation(async (_campusCode, _dateRange, roleCategory) => ({
    scope_note: "Global access: results span all campuses.",
    total_applications:
      roleCategory === "TEACHING" ? 12 : roleCategory === "NON_TEACHING" ? 20 : roleCategory === "HOUSEKEEPING" ? 5 : 42,
    open_positions: roleCategory ? 3 : 7,
    interviews_today: 3,
    joinings_today: 1,
    offers_pending: 2,
    campus_wise_hiring: [{ campus_code: "SSE", hired_count: 5, open_count: 1, in_progress_count: 3 }],
    category_wise_breakdown: REAL_SHAPE_BREAKDOWN,
    average_time_to_hire_days: 14.5,
    vacancy_closure_rate_pct: 80,
    source_wise_breakdown: [{ source: "Reference", count: 10 }],
    rejected_count: 4,
    withdrawn_count: 1,
    ...overrides,
  }));
}

describe("DashboardPage", () => {
  it("renders KPI values from the API response using StatTile", async () => {
    mockKpis();

    renderWithProviders();

    await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());
    expect(screen.getByText("Global access: results span all campuses.")).toBeInTheDocument();
    expect(screen.getByText("14.5")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("renders the category-wise split as a 3-row table (applications, open positions, hires) from real-shape data", async () => {
    mockKpis();

    renderWithProviders();

    const table = await screen.findByRole("table", { name: "Category-wise split" });

    const teachingRow = within(table).getByText("Teaching").closest("tr")!;
    expect(within(teachingRow).getByText("12")).toBeInTheDocument();
    expect(within(teachingRow).getByText("3")).toBeInTheDocument();
    expect(within(teachingRow).getByText("2")).toBeInTheDocument();

    const nonTeachingRow = within(table).getByText("Non-Teaching").closest("tr")!;
    expect(within(nonTeachingRow).getByText("20")).toBeInTheDocument();
    expect(within(nonTeachingRow).getByText("4")).toBeInTheDocument();
    expect(within(nonTeachingRow).getByText("1")).toBeInTheDocument();

    const housekeepingRow = within(table).getByText("Housekeeping").closest("tr")!;
    expect(within(housekeepingRow).getByText("5")).toBeInTheDocument();
    expect(within(housekeepingRow).getByText("1")).toBeInTheDocument();
    expect(within(housekeepingRow).getByText("0")).toBeInTheDocument();
  });

  it("renders the source-wise and rejected-vs-withdrawn bar charts with category labels and value counts", async () => {
    mockKpis();

    renderWithProviders();

    // Only 2 CategoryBarChart instances remain (source-wise, rejected-vs-
    // withdrawn) -- category-wise split is a table now, not a bar chart.
    await waitFor(() => expect(screen.getAllByTestId("category-bar-chart")).toHaveLength(2));
    const [sourceChart, rejectedChart] = screen.getAllByTestId("category-bar-chart");

    expect(within(sourceChart).getByText("Reference")).toBeInTheDocument();
    expect(within(sourceChart).getByText("10")).toBeInTheDocument();

    expect(within(rejectedChart).getByText("Rejected")).toBeInTheDocument();
    expect(within(rejectedChart).getByText("4")).toBeInTheDocument();
    expect(within(rejectedChart).getByText("Withdrawn")).toBeInTheDocument();
    expect(within(rejectedChart).getByText("1")).toBeInTheDocument();
  });

  it("shows live application counts on the category tab labels, sourced from category_wise_breakdown", async () => {
    mockKpis();

    renderWithProviders();

    await waitFor(() => expect(screen.getByRole("tab", { name: "Teaching (12)" })).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "Non-Teaching (20)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Housekeeping (5)" })).toBeInTheDocument();
    // all = sum of the 3 categories' applications (12 + 20 + 5).
    expect(screen.getByRole("tab", { name: "All (37)" })).toBeInTheDocument();
  });

  it("filters the KPI strip's numbers when a category tab is selected, but keeps the split card's rows unchanged", async () => {
    const user = userEvent.setup();
    mockKpis();

    renderWithProviders();

    await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());
    const teachingRowBefore = screen.getByRole("table", { name: "Category-wise split" }).outerHTML;

    await user.click(screen.getByRole("tab", { name: "Teaching (12)" }));

    // Top-line KPI strip narrows to Teaching's total_applications (12),
    // replacing the unfiltered 42.
    await waitFor(() => expect(screen.queryByText("42")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByText("12").length).toBeGreaterThan(0));

    // The split card's table content is identical before and after --
    // category_wise_breakdown ignores the role_category param server-side.
    const teachingRowAfter = screen.getByRole("table", { name: "Category-wise split" }).outerHTML;
    expect(teachingRowAfter).toBe(teachingRowBefore);
  });

  it("renders the campus-wise hiring chart with a legend and keeps the exact numbers visible in an adjacent table", async () => {
    mockKpis();

    renderWithProviders();

    await waitFor(() => expect(screen.getByTestId("campus-hiring-chart")).toBeInTheDocument());

    // Grouped bar chart has 3 series, so it needs a legend (scoped to the
    // chart itself -- "Hired"/"Open" also appear as adjacent table headers).
    const chart = screen.getByTestId("campus-hiring-chart");
    expect(within(chart).getByText("Hired")).toBeInTheDocument();
    expect(within(chart).getByText("Open")).toBeInTheDocument();
    expect(within(chart).getByText("In progress")).toBeInTheDocument();

    // The exact numbers stay visible in an adjacent table (there are 2
    // tables now the split card is one too -- disambiguate by content).
    const tables = screen.getAllByRole("table");
    const campusTable = tables.find((t) => within(t).queryByText("SSE"));
    expect(campusTable).toBeDefined();
    expect(within(campusTable!).getByText("5")).toBeInTheDocument();
  });

  it("shows an error message when the request fails", async () => {
    mockedGetDashboardKpis.mockRejectedValue(new Error("Failed to load"));

    renderWithProviders();

    await waitFor(() => expect(screen.getByText("Failed to load")).toBeInTheDocument());
  });

  it("shows 'Not enough data yet' for a null closure rate, not a literal 0% or bare dash", async () => {
    mockKpis({
      total_applications: 0,
      open_positions: 0,
      interviews_today: 0,
      joinings_today: 0,
      offers_pending: 0,
      campus_wise_hiring: [],
      category_wise_breakdown: [
        { role_category: "TEACHING", applications: 0, open_positions: 0, hires: 0 },
        { role_category: "NON_TEACHING", applications: 0, open_positions: 0, hires: 0 },
        { role_category: "HOUSEKEEPING", applications: 0, open_positions: 0, hires: 0 },
      ],
      average_time_to_hire_days: null,
      vacancy_closure_rate_pct: null,
      source_wise_breakdown: [],
      rejected_count: 0,
      withdrawn_count: 0,
    });

    renderWithProviders();

    // Two tiles are null here (avg time to hire, closure rate) -- both real.
    expect(await screen.findAllByText("Not enough data yet")).toHaveLength(2);
  });

  it("labels Interviews/Joinings as literally 'today' when no date range is selected", async () => {
    mockKpis();
    renderWithProviders();

    expect(await screen.findByText("Interviews today")).toBeInTheDocument();
    expect(screen.getByText("Joinings today")).toBeInTheDocument();
  });

  it("shows the Open positions tooltip's precise definition on focus", async () => {
    mockKpis();
    renderWithProviders();

    await waitFor(() => expect(screen.getByText("Open positions")).toBeInTheDocument());
    // Text is present twice by design: a visually-hidden sr-only span (for
    // screen readers, always in the DOM) and the visible hover/focus bubble
    // (role="tooltip") -- both carry the same definition.
    expect(screen.getByRole("tooltip")).toHaveTextContent(/Open HiringSlot posts in scope \(not requests\)/);
  });

  it("shows one reusable empty state for category-wise split and source-wise split when every bucket is genuinely zero", async () => {
    mockKpis({
      total_applications: 0,
      open_positions: 0,
      interviews_today: 0,
      joinings_today: 0,
      offers_pending: 0,
      campus_wise_hiring: [],
      category_wise_breakdown: [
        { role_category: "TEACHING", applications: 0, open_positions: 0, hires: 0 },
        { role_category: "NON_TEACHING", applications: 0, open_positions: 0, hires: 0 },
        { role_category: "HOUSEKEEPING", applications: 0, open_positions: 0, hires: 0 },
      ],
      average_time_to_hire_days: null,
      vacancy_closure_rate_pct: null,
      source_wise_breakdown: [],
      rejected_count: 0,
      withdrawn_count: 0,
    });

    renderWithProviders();

    // Source-wise split (empty array), category-wise split (3 rows, all
    // zero -- can't use a `.length === 0` check like the widget beside it)
    // and rejected-vs-withdrawn (both zero) all show the same reusable
    // empty-state message here.
    expect(await screen.findAllByText("No applications in this scope yet.")).toHaveLength(2);
    expect(screen.getByText("No rejections or withdrawals in this scope yet.")).toBeInTheDocument();
    // Only the source-wise and rejected-vs-withdrawn bar charts still exist;
    // category-wise split never renders a bar chart anymore.
    expect(screen.queryAllByTestId("category-bar-chart")).toHaveLength(0);
    expect(screen.queryByRole("table", { name: "Category-wise split" })).not.toBeInTheDocument();
  });
});
