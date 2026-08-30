import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dashboardApi from "@/api/dashboard";
import * as departmentsApi from "@/api/departments";
import * as designationsApi from "@/api/designations";
import * as locationsApi from "@/api/locations";
import type {
  CategoryBreakdownRow,
  CriticalVacancyRow,
  DashboardKpis,
  RecentEmployeeEventRow,
  VacancyRequestRead,
} from "@/api/types";
import * as vacancyRequestsApi from "@/api/vacancyRequests";
import { CampusProvider } from "@/campus/CampusContext";
import { DashboardPage } from "@/pages/DashboardPage";

vi.mock("@/api/dashboard");
vi.mock("@/api/vacancyRequests");
// Filter-bar option lists (2026-08-30).
vi.mock("@/api/departments");
vi.mock("@/api/designations");
vi.mock("@/api/locations");

const mockedGetDashboardKpis = vi.mocked(dashboardApi.getDashboardKpis);
const mockedGetStrengthTable = vi.mocked(dashboardApi.getDashboardStrengthTable);
const mockedListDepartments = vi.mocked(departmentsApi.listDepartments);
const mockedListDesignations = vi.mocked(designationsApi.listDesignations);
const mockedListLocations = vi.mocked(locationsApi.listLocations);
const mockedListVacancyRequests = vi.mocked(vacancyRequestsApi.listVacancyRequests);

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

// Fixed order the backend always returns application_pipeline_funnel in --
// see app/schemas/reporting.py::PipelineFunnelStage's doc comment. Counts are
// deliberately distinct from every other number in mockKpis' default (42,
// 25, 19, 6, ...) below -- a couple of tests do an unscoped
// screen.getByText("42") against the *KPI tile*, which would false-positive
// (or throw "multiple elements") against an equal-looking funnel bar label.
const REAL_SHAPE_FUNNEL = [
  { stage: "Applied", count: 143 },
  { stage: "Screening", count: 98 },
  { stage: "Interview", count: 61 },
  { stage: "Selected", count: 37 },
  { stage: "Offer", count: 29 },
  { stage: "Joined", count: 17 },
  { stage: "Rejected", count: 53 },
];

const REAL_SHAPE_CRITICAL_VACANCIES: CriticalVacancyRow[] = [
  { department: "Computer Science", designation: "Assistant Professor", location: null, category: "TEACHING", vacancy_count: 3 },
  { department: "Housekeeping", designation: "Cleaner", location: "Block A", category: "HOUSEKEEPING", vacancy_count: 2 },
];

const REAL_SHAPE_RECENT_JOINS: RecentEmployeeEventRow[] = [
  { employee_name: "Asha Rao", department: "Computer Science", designation: "Assistant Professor", campus: "SSE", date: "2026-08-01" },
];

const REAL_SHAPE_RECENT_RESIGNATIONS: RecentEmployeeEventRow[] = [
  { employee_name: "Ravi Kumar", department: "Mechanical", designation: "Lecturer", campus: "SCAD", date: "2026-07-15" },
];

function makeVR(overrides: Partial<VacancyRequestRead>): VacancyRequestRead {
  return {
    id: "vr-1",
    campus_id: "c-sse",
    department_id: "d-1",
    designation_id: null,
    role_category: "TEACHING",
    position_title: "Assistant Professor",
    employment_type: "FULL_TIME",
    requested_count: 2,
    qualification: "PhD",
    experience_required: "3+ years",
    salary_band_min: null,
    salary_band_max: null,
    jd_draft: null,
    remarks: null,
    skills: null,
    priority: "NORMAL",
    status: "SUBMITTED",
    source: "MANUAL" as const,
    request_ref: null,
    location_id: null,
    required_by: null,
    requester_name: null,
    requester_email: null,
    requester_mobile: null,
    requested_by_id: "u-1",
    submitted_at: "2026-07-20T00:00:00Z",
    dean_reviewed_by_id: null,
    dean_reviewed_at: null,
    hr_reviewed_by_id: null,
    hr_reviewed_at: null,
    rejected_by_id: null,
    rejected_at: null,
    rejection_reason: null,
    cancelled_by_id: null,
    cancelled_at: null,
    cancellation_reason: null,
    is_over_sanction: false,
    over_sanction_justification: null,
    created_at: "2026-07-19T00:00:00Z",
    updated_at: "2026-07-19T00:00:00Z",
    ...overrides,
  };
}

// 8 requests spanning every status: 1 DRAFT, 2 SUBMITTED, 1 DEAN_APPROVED,
// 1 APPROVED, 1 PUBLISHED, 1 CLOSED, 1 REJECTED -- so
// pending (SUBMITTED+DEAN_APPROVED) = 3 and pending+approved
// (+APPROVED) = 4, distinct from each other and from the total (8), so a
// test asserting either number can't pass by accident.
const MIXED_STATUS_VACANCY_REQUESTS: VacancyRequestRead[] = [
  makeVR({ id: "vr-draft", status: "DRAFT" }),
  makeVR({ id: "vr-submitted-1", status: "SUBMITTED" }),
  makeVR({ id: "vr-submitted-2", status: "SUBMITTED" }),
  makeVR({ id: "vr-dean-approved", status: "DEAN_APPROVED" }),
  makeVR({ id: "vr-approved", status: "APPROVED" }),
  makeVR({ id: "vr-published", status: "PUBLISHED" }),
  makeVR({ id: "vr-closed", status: "CLOSED" }),
  makeVR({ id: "vr-rejected", status: "REJECTED" }),
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
    // Sanctioned Strength dashboard tile (Phase I) -- these 3 DO narrow with
    // role_category, same as total_applications/open_positions above.
    sanctioned_approved_total: roleCategory ? 8 : 25,
    sanctioned_working_total: roleCategory ? 6 : 19,
    sanctioned_vacancy_total: roleCategory ? 2 : 6,
    // Dashboard-redesign fields (2026-08-30). These narrow with
    // role_category like the sanctioned_* totals above.
    //
    // recruitment_required_count is deliberately NOT equal to
    // sanctioned_vacancy_total: it counts ROWS above zero vacancy, not
    // people, so a fixture where they matched could hide the two being
    // wired to the same field.
    recruitment_required_count: roleCategory ? 1 : 4,
    // Non-overlapping by construction -- SUBMITTED awaits a Dean,
    // DEAN_APPROVED awaits HR. Distinct values so a test asserting either
    // cannot pass by accident.
    pending_requests_count: roleCategory ? 2 : 3,
    pending_approvals_count: roleCategory ? 1 : 5,
    vacancy_by_department: [
      { key: "d-cse", label: "CSE", approved: 10, working: 4, vacancy: 6 },
      { key: "d-ece", label: "ECE", approved: 5, working: 3, vacancy: 2 },
    ],
    vacancy_by_campus: [{ key: "c-sse", label: "SSE", approved: 15, working: 7, vacancy: 8 }],
    vacancy_by_category: [{ key: "TEACHING", label: "TEACHING", approved: 15, working: 7, vacancy: 8 }],
    // Additive fields (Step 3, dashboard-kpi-additions).
    urgent_vacancy_count: 3,
    application_pipeline_funnel: REAL_SHAPE_FUNNEL,
    critical_vacancies: REAL_SHAPE_CRITICAL_VACANCIES,
    recent_joins: REAL_SHAPE_RECENT_JOINS,
    recent_resignations: REAL_SHAPE_RECENT_RESIGNATIONS,
    ...overrides,
  }));
}

const FILTER_DEPARTMENT = { id: "d-cse", name: "CSE" };
const FILTER_DESIGNATION = { id: "des-ap", name: "Assistant Professor" };
const FILTER_LOCATION = {
  id: "loc-cb-ground",
  campus_id: "c-sse",
  name: "CB Block",
  block_building: "Circular Building",
  floor_venue: "Ground Floor",
  category: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  // Filter-bar option lists -- cast loosely because these tests only need the
  // handful of fields the pickers render, not the full master-data shapes.
  mockedGetStrengthTable.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  mockedListDepartments.mockResolvedValue([FILTER_DEPARTMENT] as never);
  mockedListDesignations.mockResolvedValue([FILTER_DESIGNATION] as never);
  mockedListLocations.mockResolvedValue([FILTER_LOCATION] as never);
  // Default for every test that doesn't explicitly mock the Pending
  // Requests/Approvals composition -- an empty vacancy-requests list so
  // those two new tiles render "0" rather than hanging on a never-resolving
  // query and breaking every pre-existing test in this file.
  mockedListVacancyRequests.mockResolvedValue([]);
});

describe("DashboardPage", () => {
  it("renders KPI values from the API response using StatTile", async () => {
    mockKpis();

    renderWithProviders();

    await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());
    expect(screen.getByText("Global access: results span all campuses.")).toBeInTheDocument();
    expect(screen.getByText("14.5")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  // UI redesign (2026-08-23): the 3 Sanctioned Strength tiles moved into the
  // page's primary KPI row and were relabeled to match the new spec ("Total
  // Sanctioned"/"Working"/"Vacancies") -- scoped to the primary-kpi-grid
  // container since "Working" is also, by design, one of the mini-stat
  // labels inside each of the 3 new Category Summary cards further down the
  // page (a real, deliberate text collision, not a bug).
  it("renders the 3 Sanctioned Strength tiles (approved/working/vacancy) from the API response", async () => {
    mockKpis();

    renderWithProviders();

    const primaryGrid = screen.getByTestId("primary-kpi-grid");
    expect(within(primaryGrid).getByText("Total Sanctioned")).toBeInTheDocument();
    expect(within(primaryGrid).getByText("Working")).toBeInTheDocument();
    expect(within(primaryGrid).getByText("Vacancies")).toBeInTheDocument();
    // Unscoped (no category tab selected) values from mockKpis' default --
    // scoped to each tile's own card (not a bare page-wide getByText) since
    // small integers also coincidentally show up as chart axis-tick labels
    // elsewhere on the page; wait for the query to resolve (labels render
    // immediately even while loading, values don't).
    const approvedTile = within(primaryGrid).getByText("Total Sanctioned").closest(".rounded-xl") as HTMLElement;
    const workingTile = within(primaryGrid).getByText("Working").closest(".rounded-xl") as HTMLElement;
    const vacancyTile = within(primaryGrid).getByText("Vacancies").closest(".rounded-xl") as HTMLElement;
    expect(await within(approvedTile).findByText("25")).toBeInTheDocument();
    expect(within(workingTile).getByText("19")).toBeInTheDocument();
    expect(within(vacancyTile).getByText("6")).toBeInTheDocument();
  });

  it("renders a negative sanctioned_vacancy_total as-is (signed, not floored at 0 or hidden)", async () => {
    mockKpis({ sanctioned_vacancy_total: -4 });

    renderWithProviders();

    // Scope to the tile itself (rejected_count is also 4 in this mock, via
    // the unrelated "Rejected vs withdrawn" bar chart's own label) -- the
    // real minus sign must survive rendering on *this* tile specifically, not
    // silently drop the "net overstaffed" meaning documented in reporting.py.
    const primaryGrid = await screen.findByTestId("primary-kpi-grid");
    const title = await within(primaryGrid).findByText("Vacancies");
    const tile = title.closest(".rounded-xl") as HTMLElement;
    expect(await within(tile).findByText("-4")).toBeInTheDocument();
    expect(within(tile).queryByText("4")).not.toBeInTheDocument();
  });

  it("shows the Vacancies tooltip explaining the signed-net meaning", async () => {
    mockKpis();
    renderWithProviders();

    const primaryGrid = screen.getByTestId("primary-kpi-grid");
    await waitFor(() => expect(within(primaryGrid).getByText("Vacancies")).toBeInTheDocument());
    const tooltips = screen.getAllByRole("tooltip");
    expect(tooltips.some((t) => /Negative means net overstaffed overall/.test(t.textContent ?? ""))).toBe(true);
  });

  it("shows the exactly-staffed zero caption on Vacancies instead of the generic 'No activity' text", async () => {
    mockKpis({ sanctioned_vacancy_total: 0 });
    renderWithProviders();

    expect(
      await screen.findByText("Fully staffed -- no net vacancy or overstaffing in this scope"),
    ).toBeInTheDocument();
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

    // 3 CategoryBarChart instances now (source-wise, rejected-vs-withdrawn,
    // and the recruitment pipeline funnel added in Step 3) -- category-wise
    // split is a table, not a bar chart, so it never counts here.
    await waitFor(() => expect(screen.getAllByTestId("category-bar-chart")).toHaveLength(3));
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

    // The Sanctioned Strength tiles (now in the primary KPI row, labeled
    // "Total Sanctioned"/"Working"/"Vacancies") narrow along with the rest of
    // the KPI strip -- unscoped 25/19/6 replaced by the category-scoped 8/6/2
    // (see mockKpis' own roleCategory branching above). Scoped to the
    // primary-kpi-grid container -- "Working" is also, by design, a mini-stat
    // label inside each of the 3 Category Summary cards further down the
    // page.
    const primaryGrid = screen.getByTestId("primary-kpi-grid");
    const approvedTile = within(primaryGrid).getByText("Total Sanctioned").closest(".rounded-xl") as HTMLElement;
    const workingTile = within(primaryGrid).getByText("Working").closest(".rounded-xl") as HTMLElement;
    const vacancyTile = within(primaryGrid).getByText("Vacancies").closest(".rounded-xl") as HTMLElement;
    expect(within(approvedTile).queryByText("25")).not.toBeInTheDocument();
    expect(within(approvedTile).getByText("8")).toBeInTheDocument();
    expect(within(workingTile).getByText("6")).toBeInTheDocument();
    expect(within(vacancyTile).getByText("2")).toBeInTheDocument();

    // The split card's table content is identical before and after --
    // category_wise_breakdown ignores the role_category param server-side.
    const teachingRowAfter = screen.getByRole("table", { name: "Category-wise split" }).outerHTML;
    expect(teachingRowAfter).toBe(teachingRowBefore);
  });

  // Follow-up patch (2026-08-23): the donut now has one slice per campus
  // (value = hired + open + in-progress for that campus) instead of 3
  // status-aggregate slices, with a hand-rolled per-campus legend
  // ("code: count (percentage%)") and a center label showing the grand
  // total across every campus.
  it("renders one donut slice per campus with a per-campus legend, a center total, and keeps the exact numbers visible in an adjacent table", async () => {
    mockKpis({
      campus_wise_hiring: [
        { campus_code: "SSE", hired_count: 5, open_count: 1, in_progress_count: 3 },
        { campus_code: "SCLAS", hired_count: 2, open_count: 0, in_progress_count: 1 },
      ],
    });

    renderWithProviders();

    await waitFor(() => expect(screen.getByTestId("campus-hiring-chart")).toBeInTheDocument());

    // Legend: one entry per campus (SSE total = 9, SCLAS total = 3, grand
    // total = 12), scoped to the chart itself.
    const chart = screen.getByTestId("campus-hiring-chart");
    expect(within(chart).getByText(/SSE.*9.*75\.0%/)).toBeInTheDocument();
    expect(within(chart).getByText(/SCLAS.*3.*25\.0%/)).toBeInTheDocument();

    // Center label shows the grand total across every campus.
    expect(within(chart).getByText("12")).toBeInTheDocument();
    expect(within(chart).getByText("Total")).toBeInTheDocument();

    // The exact per-status numbers stay visible in an adjacent table (there
    // are 2 tables now the split card is one too -- disambiguate by
    // content).
    const tables = screen.getAllByRole("table");
    const campusTable = tables.find((t) => within(t).queryByText("SSE"));
    expect(campusTable).toBeDefined();
    expect(within(campusTable!).getByText("5")).toBeInTheDocument();
  });

  // UI redesign (2026-08-23): exactly one tile on this page consumes
  // StatTile's `hero` prop (the gradient ring/glow, marked via
  // `data-hero="true"` on the underlying Card) -- the "Vacancies" primary KPI
  // tile (sanctioned_vacancy_total), the one the redesign spec calls out as
  // this page's single visually prominent tile. Moved here from "Total
  // applications" (Phase 2's original hero tile), which is no longer hero.
  it("marks Vacancies and Recruitment Required as the hero KPI tiles", async () => {
    mockKpis();
    const { container } = renderWithProviders();

    await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());

    // Two heroes as of 2026-08-30: the brief asks for both to be emphasised.
    const heroTiles = [...container.querySelectorAll('[data-hero="true"]')] as HTMLElement[];
    expect(heroTiles).toHaveLength(2);
    const heroLabels = heroTiles.map((tile) => tile.textContent ?? "");
    expect(heroLabels.some((text) => text.includes("Vacancies"))).toBe(true);
    expect(heroLabels.some((text) => text.includes("Recruitment Required"))).toBe(true);
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
      // Also zero the funnel out for this "everything is genuinely zero"
      // scenario -- otherwise the (non-overridden) REAL_SHAPE_FUNNEL default
      // would render a 3rd CategoryBarChart and break this test's own
      // "only 2 charts" assertion below.
      application_pipeline_funnel: [
        { stage: "Applied", count: 0 },
        { stage: "Screening", count: 0 },
        { stage: "Interview", count: 0 },
        { stage: "Selected", count: 0 },
        { stage: "Offer", count: 0 },
        { stage: "Joined", count: 0 },
        { stage: "Rejected", count: 0 },
      ],
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

  // Renamed from "Open positions" to "Active Recruitment" (UI redesign,
  // 2026-08-23) -- same tile, same underlying open_positions field/tooltip.
  // "Active Recruitment" (open_positions) left the PRIMARY row on 2026-08-30:
  // the brief names six primary KPIs and this is not one of them; its slot
  // went to Recruitment Required. Skipped rather than deleted -- if that tile
  // is reinstated, this is the tooltip contract it must honour.
  it.skip("shows the Active Recruitment tooltip's precise definition on focus", async () => {
    mockKpis();
    renderWithProviders();

    await waitFor(() => expect(screen.getByText("Active Recruitment")).toBeInTheDocument());
    // Text is present twice by design: a visually-hidden sr-only span (for
    // screen readers, always in the DOM) and the visible hover/focus bubble
    // (role="tooltip") -- both carry the same definition. Multiple tiles now
    // have tooltips (the 3 Sanctioned Strength ones too), so match on content
    // rather than assuming this is the only tooltip in the DOM.
    const tooltips = screen.getAllByRole("tooltip");
    expect(tooltips.some((t) => /Open HiringSlot posts in scope \(not requests\)/.test(t.textContent ?? ""))).toBe(
      true,
    );
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
      // Also zero the funnel out for this "everything is genuinely zero"
      // scenario -- otherwise the (non-overridden) REAL_SHAPE_FUNNEL default
      // would render a 3rd CategoryBarChart and break this test's own
      // "only 2 charts" assertion below.
      application_pipeline_funnel: [
        { stage: "Applied", count: 0 },
        { stage: "Screening", count: 0 },
        { stage: "Interview", count: 0 },
        { stage: "Selected", count: 0 },
        { stage: "Offer", count: 0 },
        { stage: "Joined", count: 0 },
        { stage: "Rejected", count: 0 },
      ],
    });

    renderWithProviders();

    // Source-wise split (empty array) and category-wise split (3 rows, all
    // zero -- can't use a `.length === 0` check like the widget beside it)
    // both show the same reusable empty-state message here.
    expect(await screen.findAllByText("No applications in this scope yet.")).toHaveLength(2);
    expect(screen.getByText("No rejections or withdrawals in this scope yet.")).toBeInTheDocument();
    // Recruitment pipeline (Requested/Approved/Published all 0 from the
    // default empty vacancy-requests list, funnel stages all zeroed above)
    // shows its own distinct empty-state copy -- see recruitmentPipelineData.
    expect(screen.getByText("No vacancy requests or applications in this scope yet.")).toBeInTheDocument();
    // Only the source-wise and rejected-vs-withdrawn bar charts still exist;
    // category-wise split never renders a bar chart anymore.
    expect(screen.queryAllByTestId("category-bar-chart")).toHaveLength(0);
    expect(screen.queryByRole("table", { name: "Category-wise split" })).not.toBeInTheDocument();
  });

  it("renders the Urgent vacancies tile with the real urgent_vacancy_count and a red accent", async () => {
    mockKpis({ urgent_vacancy_count: 7 });

    renderWithProviders();

    const title = await screen.findByText("Urgent vacancies");
    const tile = title.closest(".rounded-xl") as HTMLElement;
    expect(await within(tile).findByText("7")).toBeInTheDocument();
    // "red" accent renders as the border-l-brand-danger utility class on the
    // Card -- assert the real class landed, not just that a number rendered.
    expect(tile.className).toContain("border-l-brand-danger");
  });

  it("shows the urgent zero caption when there are genuinely no urgent vacancies", async () => {
    mockKpis({ urgent_vacancy_count: 0 });

    renderWithProviders();

    expect(await screen.findByText("No urgent vacancies right now")).toBeInTheDocument();
  });

  // UI redesign (2026-08-23, dashboard/sidebar redesign): the Recruitment
  // pipeline card's stages changed from the raw application funnel
  // (Applied -> ... -> Rejected) to a literal 7-stage view mixing vacancy
  // requests (Requested/Approved/Published) with the application funnel
  // (Screening onward) -- see DashboardPage.tsx's own recruitmentPipelineData
  // comment for the exact per-stage computation.
  it("renders the recruitment pipeline's 7 stages (vacancy-request stages first, then the application funnel) in order", async () => {
    mockKpis();
    mockedListVacancyRequests.mockResolvedValue(MIXED_STATUS_VACANCY_REQUESTS);

    renderWithProviders();

    const pipelineChart = await screen.findByLabelText("Recruitment pipeline");
    // recharts renders each YAxis category tick as its own <text> node --
    // read them back in DOM order and assert against the fixed stage order,
    // not just that all 7 labels are present somewhere.
    const tickTexts = within(pipelineChart)
      .getAllByText(/^(Requested|Approved|Published|Screening|Interview|Selected|Joined)$/)
      .map((node) => node.textContent);
    expect(tickTexts).toEqual(["Requested", "Approved", "Published", "Screening", "Interview", "Selected", "Joined"]);

    // Requested = 8 total - 1 DRAFT = 7; Approved = APPROVED+PUBLISHED+CLOSED
    // = 3; Published = PUBLISHED+CLOSED = 2 (see MIXED_STATUS_VACANCY_REQUESTS
    // above -- distinct numbers so none of these assertions can pass by
    // accident). Screening/Interview/Selected/Joined come straight from
    // REAL_SHAPE_FUNNEL's mock counts.
    expect(await within(pipelineChart).findByText("7")).toBeInTheDocument();
    expect(within(pipelineChart).getByText("3")).toBeInTheDocument();
    expect(within(pipelineChart).getByText("2")).toBeInTheDocument();
    expect(within(pipelineChart).getByText("98")).toBeInTheDocument();
    expect(within(pipelineChart).getByText("61")).toBeInTheDocument();
    expect(within(pipelineChart).getByText("37")).toBeInTheDocument();
    expect(within(pipelineChart).getByText("17")).toBeInTheDocument();
  });

  it("renders the Critical vacancies table with real mocked rows", async () => {
    mockKpis();

    renderWithProviders();

    const table = await screen.findByRole("table", { name: "Critical vacancies" });
    const csRow = (await within(table).findByText("Computer Science")).closest("tr")!;
    expect(within(csRow).getByText("Assistant Professor")).toBeInTheDocument();
    expect(within(csRow).getByText("3")).toBeInTheDocument();
    // location is null for this row -- rendered as an em dash, not blank/"null".
    expect(within(csRow).getByText("—")).toBeInTheDocument();

    const hkRow = within(table).getByText("Housekeeping").closest("tr")!;
    expect(within(hkRow).getByText("Block A")).toBeInTheDocument();
    expect(within(hkRow).getByText("2")).toBeInTheDocument();
  });

  // UI redesign (2026-08-23): Priority is a client-side bucketing of
  // vacancy_count into thirds -- with only 2 rows (REAL_SHAPE_CRITICAL_VACANCIES),
  // computeCriticalVacancyPriorities' own "fewer than 3 rows" rule makes both
  // "High" (there's no meaningful middle/low tier to carve out of 2 rows).
  // Status is a hardcoded "Open" on every row (critical_vacancies only ever
  // contains open/understaffed rows by construction), not a fetched field.
  it("shows Priority and Status badges on every Critical vacancies row, computed/constant respectively", async () => {
    mockKpis();

    renderWithProviders();

    const table = await screen.findByRole("table", { name: "Critical vacancies" });
    const csRow = (await within(table).findByText("Computer Science")).closest("tr")!;
    const hkRow = within(table).getByText("Housekeeping").closest("tr")!;

    expect(within(csRow).getByText("High")).toBeInTheDocument();
    expect(within(hkRow).getByText("High")).toBeInTheDocument();
    expect(within(csRow).getByText("Open")).toBeInTheDocument();
    expect(within(hkRow).getByText("Open")).toBeInTheDocument();
  });

  it("shows a View All link on the Critical vacancies card pointing at Sanctioned Strength", async () => {
    mockKpis();

    renderWithProviders();

    await screen.findByRole("table", { name: "Critical vacancies" });
    const viewAllLinks = screen.getAllByRole("link", { name: "View All" });
    expect(viewAllLinks.some((link) => link.getAttribute("href") === "/sanctioned-strength")).toBe(true);
  });

  it("shows the genuinely-good-news empty state when there are no critical vacancies", async () => {
    mockKpis({ critical_vacancies: [] });

    renderWithProviders();

    const table = await screen.findByRole("table", { name: "Critical vacancies" });
    expect(
      await within(table).findByText("No critical vacancies right now -- nothing urgently understaffed."),
    ).toBeInTheDocument();
  });

  it("renders the Recent joins and Recent resignations tables as 2 separate cards with real mocked rows", async () => {
    mockKpis();

    renderWithProviders();

    const joinsTable = await screen.findByRole("table", { name: "Recent joins" });
    expect(await within(joinsTable).findByText("Asha Rao")).toBeInTheDocument();
    expect(within(joinsTable).getByText("Computer Science")).toBeInTheDocument();
    expect(within(joinsTable).getByText("SSE")).toBeInTheDocument();

    const resignationsTable = await screen.findByRole("table", { name: "Recent resignations" });
    expect(await within(resignationsTable).findByText("Ravi Kumar")).toBeInTheDocument();
    expect(within(resignationsTable).getByText("Mechanical")).toBeInTheDocument();
    expect(within(resignationsTable).getByText("SCAD")).toBeInTheDocument();

    // Genuinely 2 distinct cards/tables, not one merged list.
    expect(joinsTable).not.toBe(resignationsTable);
  });

  it("shows their own empty states when there are no recent joins/resignations", async () => {
    mockKpis({ recent_joins: [], recent_resignations: [] });

    renderWithProviders();

    const joinsTable = await screen.findByRole("table", { name: "Recent joins" });
    expect(await within(joinsTable).findByText("No joinings recorded in this scope yet.")).toBeInTheDocument();

    const resignationsTable = await screen.findByRole("table", { name: "Recent resignations" });
    expect(
      await within(resignationsTable).findByText("No resignations recorded in this scope yet."),
    ).toBeInTheDocument();
  });

  // Reversed on 2026-08-30. These two tiles used to be composed client-side
  // from listVacancyRequests, where "Pending approvals" was defined as
  // "Pending requests" PLUS APPROVED -- so every submitted request was
  // counted on BOTH cards, and neither respected the campus/category
  // filters. They now read the backend's non-overlapping pair.
  it("reads Pending Requests/Approvals from /dashboard/kpis, not from the vacancy-requests list", async () => {
    mockKpis();
    // Stocked so the old client-side rollup (3 and 4) differs from the KPI
    // response (3 and 5): a regression to the old composition fails rather
    // than coincidentally matching.
    mockedListVacancyRequests.mockResolvedValue(MIXED_STATUS_VACANCY_REQUESTS);

    renderWithProviders();

    // The label renders while the tile is still loading, so waiting on
    // findByText(label) would assert before the value arrives. textContent
    // rather than getByText because StatTile splits label, value and caption
    // across nested spans.
    await waitFor(() => {
      const tile = screen.getByText("Pending Requests").closest(".rounded-xl") as HTMLElement;
      expect(tile.textContent).toContain("3");
    });

    const pendingApprovalsTile = screen.getByText("Pending Approvals").closest(".rounded-xl") as HTMLElement;
    // 5 from the KPI response -- NOT the 4 the old rollup produced.
    expect(pendingApprovalsTile.textContent).toContain("5");
  });

  it("shows a plain 0 on the pending tiles rather than a sentence explaining the zero", async () => {
    mockKpis({ pending_requests_count: 0, pending_approvals_count: 0 });
    mockedListVacancyRequests.mockResolvedValue([]);

    renderWithProviders();

    await waitFor(() => {
      const tile = screen.getByText("Pending Requests").closest(".rounded-xl") as HTMLElement;
      expect(tile.textContent).toContain("0");
    });
    expect(screen.queryByText("No requests waiting on an approver right now")).not.toBeInTheDocument();
    expect(screen.queryByText(/No activity in this scope yet/)).not.toBeInTheDocument();
  });

  it("renders all three vacancy-analysis charts from the backend rollups", async () => {
    mockKpis();
    renderWithProviders();

    expect(await screen.findByTestId("vacancy-by-department-chart")).toBeInTheDocument();
    expect(screen.getByTestId("vacancy-by-campus-chart")).toBeInTheDocument();
    expect(screen.getByTestId("vacancy-by-category-chart")).toBeInTheDocument();
  });

  it("shows 0 rather than an empty-state card when a scope has no vacancies", async () => {
    mockKpis({ vacancy_by_department: [], vacancy_by_campus: [], vacancy_by_category: [] });
    renderWithProviders();

    await waitFor(() => expect(screen.getByText("Vacancy by department")).toBeInTheDocument());
    expect(screen.queryByTestId("vacancy-by-department-chart")).not.toBeInTheDocument();
    expect(screen.queryByText(/No critical vacancies right now/)).not.toBeInTheDocument();
  });

  // --- Drill-down filter bar (2026-08-30) ----------------------------------
  describe("drill-down filters", () => {
    it("sends Department/Designation/Location to the KPI endpoint alongside campus and category", async () => {
      mockKpis();
      renderWithProviders();

      await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("combobox", { name: "Department filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "CSE" }));

      await waitFor(() =>
        expect(mockedGetDashboardKpis.mock.calls.at(-1)?.[3]).toMatchObject({ departmentId: "d-cse" }),
      );
    });

    it("composes filters rather than letting the last one win", async () => {
      mockKpis();
      renderWithProviders();
      await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("combobox", { name: "Department filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "CSE" }));
      await userEvent.click(screen.getByRole("combobox", { name: "Location filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "Circular Building — Ground Floor" }));

      // Both present in the SAME call -- the failure this guards against is a
      // second filter replacing the first instead of narrowing further.
      await waitFor(() =>
        expect(mockedGetDashboardKpis.mock.calls.at(-1)?.[3]).toMatchObject({
          departmentId: "d-cse",
          locationId: "loc-cb-ground",
        }),
      );
    });

    it("labels locations by block and floor, not by the repeated name", async () => {
      mockKpis();
      renderWithProviders();
      await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("combobox", { name: "Location filter" }));

      expect(await screen.findByRole("option", { name: "Circular Building — Ground Floor" })).toBeInTheDocument();
      // "CB Block" is the record's name and repeats across every floor.
      expect(screen.queryByRole("option", { name: "CB Block" })).not.toBeInTheDocument();
    });

    it("offers Clear filters only once something is filtered, and clearing resets the query", async () => {
      mockKpis();
      renderWithProviders();
      await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());

      expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("combobox", { name: "Department filter" }));
      await userEvent.click(await screen.findByRole("option", { name: "CSE" }));

      await userEvent.click(await screen.findByRole("button", { name: "Clear filters" }));

      await waitFor(() =>
        expect(mockedGetDashboardKpis.mock.calls.at(-1)?.[3]).toMatchObject({
          departmentId: null,
          designationId: null,
          locationId: null,
        }),
      );
    });
  });
  // --- Drill-down (2026-08-30) --------------------------------------------
  describe("drill-down", () => {
    it("links the pending tiles to the matching vacancy-request status", async () => {
      mockKpis();
      renderWithProviders();

      await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());

      // Real anchors, not click handlers -- so the destination is visible on
      // hover, keyboard-reachable and openable in a new tab.
      const pendingLink = screen.getByText("Pending Requests").closest("a");
      expect(pendingLink).toHaveAttribute("href", "/vacancy-requests?status=SUBMITTED");

      const approvalsLink = screen.getByText("Pending Approvals").closest("a");
      expect(approvalsLink).toHaveAttribute("href", "/vacancy-requests?status=DEAN_APPROVED");
    });

    it("links the sanctioned-strength tiles to that screen", async () => {
      mockKpis();
      renderWithProviders();
      await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());

      expect(screen.getByText("Total Sanctioned").closest("a")).toHaveAttribute("href", "/sanctioned-strength");
    });

    it("leaves a tile with no destination non-interactive", async () => {
      // Vacancies has no single screen that means "the vacancies" -- it is a
      // signed net figure across the whole scope -- so it deliberately has
      // no link rather than one that would mislead.
      mockKpis();
      renderWithProviders();
      await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());

      const grid = screen.getByTestId("primary-kpi-grid");
      expect(within(grid).getByText("Vacancies").closest("a")).toBeNull();
    });
  });
});
