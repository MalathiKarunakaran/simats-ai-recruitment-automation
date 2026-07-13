import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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

describe("DashboardPage", () => {
  it("renders KPI values from the API response", async () => {
    mockedGetDashboardKpis.mockResolvedValue({
      scope_note: "Global access: results span all campuses.",
      total_applications: 42,
      open_positions: 7,
      interviews_today: 3,
      joinings_today: 1,
      offers_pending: 2,
      campus_wise_hiring: [{ campus_code: "SSE", hired_count: 5 }],
      average_time_to_hire_days: 14.5,
      vacancy_closure_rate_pct: 80,
    });

    renderWithProviders();

    await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());
    expect(screen.getByText("Global access: results span all campuses.")).toBeInTheDocument();
    expect(screen.getByText("14.5")).toBeInTheDocument();
    expect(screen.getByText("SSE")).toBeInTheDocument();
  });

  it("shows an error message when the request fails", async () => {
    mockedGetDashboardKpis.mockRejectedValue(new Error("Failed to load"));

    renderWithProviders();

    await waitFor(() => expect(screen.getByText("Failed to load")).toBeInTheDocument());
  });
});
