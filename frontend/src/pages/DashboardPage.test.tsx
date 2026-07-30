import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import * as dashboardApi from "@/api/dashboard";
import { CampusProvider } from "@/campus/CampusContext";
import { DashboardPage } from "@/pages/DashboardPage";

vi.mock("@/api/dashboard");

const mockedGetDashboardKpis = vi.mocked(dashboardApi.getDashboardKpis);

function renderWithProviders() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CampusProvider>
        <DashboardPage />
      </CampusProvider>
    </QueryClientProvider>,
  );
}

// The dashboard fires one call for the main KPIs and one per role category
// (for the category-wise split chart) -- differentiate by the role_category
// argument so each renders a distinct, unambiguous number.
function mockKpis() {
  mockedGetDashboardKpis.mockImplementation(async (_campusCode, _dateRange, roleCategory) => ({
    scope_note: "Global access: results span all campuses.",
    total_applications: roleCategory ? 9 : 42,
    open_positions: 7,
    interviews_today: 3,
    joinings_today: 1,
    offers_pending: 2,
    campus_wise_hiring: [{ campus_code: "SSE", hired_count: 5, open_count: 1, in_progress_count: 3 }],
    average_time_to_hire_days: 14.5,
    vacancy_closure_rate_pct: 80,
    source_wise_breakdown: [{ source: "Reference", count: 10 }],
    rejected_count: 4,
    withdrawn_count: 1,
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

  it("renders the source-wise and category-wise bar charts with category labels and value counts", async () => {
    mockKpis();

    renderWithProviders();

    // Three CategoryBarChart instances: source-wise, category-wise, rejected-vs-withdrawn.
    await waitFor(() => expect(screen.getAllByTestId("category-bar-chart")).toHaveLength(3));
    const [sourceChart, categoryChart, rejectedChart] = screen.getAllByTestId("category-bar-chart");

    expect(within(sourceChart).getByText("Reference")).toBeInTheDocument();
    expect(within(sourceChart).getByText("10")).toBeInTheDocument();

    expect(within(categoryChart).getByText("Teaching")).toBeInTheDocument();
    expect(within(categoryChart).getByText("Non-Teaching")).toBeInTheDocument();
    expect(within(categoryChart).getByText("Housekeeping")).toBeInTheDocument();
    expect(within(categoryChart).getAllByText("9")).toHaveLength(3);

    expect(within(rejectedChart).getByText("Rejected")).toBeInTheDocument();
    expect(within(rejectedChart).getByText("4")).toBeInTheDocument();
    expect(within(rejectedChart).getByText("Withdrawn")).toBeInTheDocument();
    expect(within(rejectedChart).getByText("1")).toBeInTheDocument();
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

    // The exact numbers stay visible in an adjacent table, not just the chart.
    const table = screen.getByRole("table");
    expect(within(table).getByText("SSE")).toBeInTheDocument();
    expect(within(table).getByText("5")).toBeInTheDocument();
  });

  it("shows an error message when the request fails", async () => {
    mockedGetDashboardKpis.mockRejectedValue(new Error("Failed to load"));

    renderWithProviders();

    await waitFor(() => expect(screen.getByText("Failed to load")).toBeInTheDocument());
  });
});
