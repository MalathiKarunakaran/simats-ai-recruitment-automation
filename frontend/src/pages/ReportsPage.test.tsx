import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as reportsApi from "@/api/reports";
import type { ADBriefingResponse, ReportResponse } from "@/api/types";
import { CampusProvider } from "@/campus/CampusContext";
import { ReportsPage } from "@/pages/ReportsPage";

vi.mock("@/api/reports");

const mockedGetReport = vi.mocked(reportsApi.getReport);
const mockedGetAdBriefing = vi.mocked(reportsApi.getAdBriefing);

const EMPTY_REPORT: ReportResponse = {
  scope_note: "Global access: results span all campuses.",
  generated_at: "2026-01-01T00:00:00Z",
  rows: [],
};

const FUNNEL_REPORT: ReportResponse = {
  scope_note: "Global access: results span all campuses.",
  generated_at: "2026-01-01T00:00:00Z",
  rows: [{ campus_code: "SSE", status: "APPLIED", count: 4 }],
};

const BRIEFING: ADBriefingResponse = {
  scope_note: "Global access: results span all campuses.",
  generated_at: "2026-01-01T00:00:00Z",
  kpi_headline: {
    total_applications: 5,
    open_positions: 1,
    interviews_today: 0,
    joinings_today: 0,
    offers_pending: 0,
    vacancy_closure_rate_pct: 50,
  },
  campus_role_breakdown: [
    { campus_code: "SSE", role_category: "TEACHING", open_positions: 1, in_pipeline: 2, hired: 1 },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CampusProvider>
        <MemoryRouter>
          <ReportsPage />
        </MemoryRouter>
      </CampusProvider>
    </QueryClientProvider>,
  );
}

describe("ReportsPage", () => {
  it("renders the recruitment-funnel report by default and the AD briefing headline", async () => {
    mockedGetReport.mockResolvedValue(FUNNEL_REPORT);
    mockedGetAdBriefing.mockResolvedValue(BRIEFING);

    renderPage();

    await waitFor(() => expect(mockedGetReport).toHaveBeenCalledWith("recruitment-funnel", expect.anything()));
    expect(await screen.findByText("APPLIED")).toBeInTheDocument();
    expect(screen.getAllByText("SSE").length).toBeGreaterThan(0);
    expect(screen.getByText("Total applications")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("shows the empty-state message when a report has no rows", async () => {
    mockedGetReport.mockResolvedValue(EMPTY_REPORT);
    mockedGetAdBriefing.mockResolvedValue(BRIEFING);

    renderPage();

    await waitFor(() => expect(screen.getByText(/No data in this scope yet/)).toBeInTheDocument());
  });

  it("re-fetches with the new report type when the selector changes", async () => {
    mockedGetReport.mockResolvedValue(FUNNEL_REPORT);
    mockedGetAdBriefing.mockResolvedValue(BRIEFING);

    renderPage();
    await waitFor(() =>
      expect(mockedGetReport).toHaveBeenCalledWith("recruitment-funnel", { campusCode: null, roleCategory: null }),
    );

    await userEvent.click(screen.getAllByRole("combobox")[0]);
    await userEvent.click(await screen.findByRole("option", { name: "Offers" }));

    await waitFor(() =>
      expect(mockedGetReport).toHaveBeenCalledWith("offers", { campusCode: null, roleCategory: null }),
    );
  });
});
