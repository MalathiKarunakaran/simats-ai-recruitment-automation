import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as reportsApi from "@/api/reports";
import type { ADBriefingResponse, ReportResponse, WeeklyRecruitmentStatusResponse } from "@/api/types";
import { CampusProvider } from "@/campus/CampusContext";
import { ReportsPage } from "@/pages/ReportsPage";

vi.mock("@/api/reports");

const mockedGetReport = vi.mocked(reportsApi.getReport);
const mockedGetAdBriefing = vi.mocked(reportsApi.getAdBriefing);
const mockedGetWeeklyStatus = vi.mocked(reportsApi.getWeeklyStatus);
const mockedDownloadReportExport = vi.mocked(reportsApi.downloadReportExport);
const mockedDownloadWeeklyStatusExport = vi.mocked(reportsApi.downloadWeeklyStatusExport);

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
  period_label: "Today",
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

const WEEKLY_STATUS: WeeklyRecruitmentStatusResponse = {
  scope_note: "Global access: results span all campuses.",
  generated_at: "2026-01-01T00:00:00Z",
  period_label: "This week",
  start_date: "2026-01-05",
  end_date: "2026-01-09",
  total_interviewed: 20,
  total_selected: 8,
  total_waiting: 3,
  total_rejected: 9,
  total_joined: 5,
  selection_rate_pct: 40,
  joined_by_category: { TEACHING: 3, NON_TEACHING: 2, HOUSEKEEPING: 0 },
  teaching_rows: [
    { group_label: "SSE", attended: 10, selected: 4, waiting: 1, rejected: 5, upcoming_join: null, joined: null },
  ],
  non_teaching_rows: [
    { group_label: "Librarian", attended: 10, selected: 4, waiting: 2, rejected: 4, upcoming_join: 2, joined: 2 },
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

  it("shows the AD briefing's period label and re-fetches with a date range when selected", async () => {
    mockedGetReport.mockResolvedValue(FUNNEL_REPORT);
    mockedGetAdBriefing.mockResolvedValue(BRIEFING);

    renderPage();
    await waitFor(() =>
      expect(mockedGetAdBriefing).toHaveBeenCalledWith({ campusCode: null, startDate: null, endDate: null }),
    );
    expect(await screen.findByText(/showing: Today/)).toBeInTheDocument();

    mockedGetAdBriefing.mockResolvedValue({ ...BRIEFING, period_label: "This week" });
    // Two DateRangeControls render on this page (Report card, then AD
    // Briefing card) -- both start out showing "All time", so pick the
    // second (AD Briefing's) by render order rather than text alone.
    await userEvent.click(screen.getAllByRole("button", { name: /All time/ })[1]);
    await userEvent.click(await screen.findByRole("button", { name: "This week" }));

    await waitFor(() =>
      expect(mockedGetAdBriefing).toHaveBeenCalledWith(
        expect.objectContaining({ campusCode: null, startDate: expect.any(String), endDate: expect.any(String) }),
      ),
    );
  });

  it("re-fetches with the new report type when the selector changes", async () => {
    mockedGetReport.mockResolvedValue(FUNNEL_REPORT);
    mockedGetAdBriefing.mockResolvedValue(BRIEFING);

    renderPage();
    await waitFor(() =>
      expect(mockedGetReport).toHaveBeenCalledWith("recruitment-funnel", {
        campusCode: null,
        roleCategory: null,
        startDate: null,
        endDate: null,
      }),
    );

    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: "Offers" }));

    await waitFor(() =>
      expect(mockedGetReport).toHaveBeenCalledWith("offers", {
        campusCode: null,
        roleCategory: null,
        startDate: null,
        endDate: null,
      }),
    );
  });

  it("renders CategoryTabs on the Report card and re-fetches (live query + export) with role_category when a tab is selected", async () => {
    mockedGetReport.mockResolvedValue(FUNNEL_REPORT);
    mockedGetAdBriefing.mockResolvedValue(BRIEFING);
    mockedDownloadReportExport.mockResolvedValue(undefined);

    renderPage();
    await waitFor(() =>
      expect(mockedGetReport).toHaveBeenCalledWith(
        "recruitment-funnel",
        expect.objectContaining({ roleCategory: null }),
      ),
    );

    expect(screen.getByRole("tab", { name: /^All/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Teaching/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Non-Teaching/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Housekeeping/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /^Teaching/ }));

    await waitFor(() =>
      expect(mockedGetReport).toHaveBeenCalledWith(
        "recruitment-funnel",
        expect.objectContaining({ roleCategory: "TEACHING" }),
      ),
    );

    await userEvent.click(screen.getByRole("button", { name: "Export as Excel" }));

    await waitFor(() =>
      expect(mockedDownloadReportExport).toHaveBeenCalledWith(
        "recruitment-funnel",
        expect.objectContaining({ roleCategory: "TEACHING" }),
      ),
    );
  });

  it("re-fetches the main report with a date range when the Report card's date control is used", async () => {
    mockedGetReport.mockResolvedValue(FUNNEL_REPORT);
    mockedGetAdBriefing.mockResolvedValue(BRIEFING);

    renderPage();
    await waitFor(() =>
      expect(mockedGetReport).toHaveBeenCalledWith("recruitment-funnel", {
        campusCode: null,
        roleCategory: null,
        startDate: null,
        endDate: null,
      }),
    );

    // The Report card's DateRangeControl is the first "All time" button.
    await userEvent.click(screen.getAllByRole("button", { name: /All time/ })[0]);
    await userEvent.click(await screen.findByRole("button", { name: "This week" }));

    await waitFor(() =>
      expect(mockedGetReport).toHaveBeenCalledWith(
        "recruitment-funnel",
        expect.objectContaining({ startDate: expect.any(String), endDate: expect.any(String) }),
      ),
    );
  });

  it("renders Weekly Recruitment Status KPIs and both breakdown tables", async () => {
    mockedGetReport.mockResolvedValue(FUNNEL_REPORT);
    mockedGetAdBriefing.mockResolvedValue(BRIEFING);
    mockedGetWeeklyStatus.mockResolvedValue(WEEKLY_STATUS);

    renderPage();

    expect(await screen.findByText("Weekly Recruitment Status")).toBeInTheDocument();
    await waitFor(() => expect(mockedGetWeeklyStatus).toHaveBeenCalled());

    // KPI tiles. "Selected"/"Rejected" also appear as table column headers
    // below, so assert presence via getAllByText rather than getByText.
    expect(await screen.findByText("Total Interviewed")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getAllByText("Selected").length).toBeGreaterThan(0);
    expect(screen.getByText("Waiting List")).toBeInTheDocument();
    expect(screen.getAllByText("Rejected").length).toBeGreaterThan(0);
    expect(screen.getByText("Joined This Week")).toBeInTheDocument();

    // Teaching Staff table (campus-wise) -- upcoming_join/joined are null on
    // these rows and must render as a blank/dash, never the string "null".
    expect(screen.getByText("Teaching Staff — Campus-wise")).toBeInTheDocument();
    expect(screen.getAllByText("SSE").length).toBeGreaterThan(0);
    expect(screen.queryByText("null")).not.toBeInTheDocument();

    // Non-Teaching Staff table (position-wise) -- header stays "Department".
    expect(screen.getByText("Non-Teaching Staff — Position-wise")).toBeInTheDocument();
    expect(screen.getByText("Librarian")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Department" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Position" })).not.toBeInTheDocument();

    // Category-wise joined tiles.
    expect(screen.getByText("Non-Teaching")).toBeInTheDocument();
    expect(screen.getByText("Housekeeping")).toBeInTheDocument();

    // Footer.
    expect(screen.getByText(/Overall selection rate: 40% \| Prepared by the Recruitment Office/)).toBeInTheDocument();
  });

  it("calls downloadWeeklyStatusExport with the current date range when Download PowerPoint is clicked", async () => {
    mockedGetReport.mockResolvedValue(FUNNEL_REPORT);
    mockedGetAdBriefing.mockResolvedValue(BRIEFING);
    mockedGetWeeklyStatus.mockResolvedValue(WEEKLY_STATUS);
    mockedDownloadWeeklyStatusExport.mockResolvedValue(undefined);

    renderPage();
    await waitFor(() => expect(mockedGetWeeklyStatus).toHaveBeenCalled());
    const { campusCode, startDate, endDate } = mockedGetWeeklyStatus.mock.calls[0][0];

    await userEvent.click(screen.getByRole("button", { name: "Download PowerPoint" }));

    await waitFor(() =>
      expect(mockedDownloadWeeklyStatusExport).toHaveBeenCalledWith({ campusCode, startDate, endDate }),
    );
  });
});
