import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dashboardApi from "@/api/dashboard";
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

const mockedGetDashboardKpis = vi.mocked(dashboardApi.getDashboardKpis);
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
    // Additive fields (Step 3, dashboard-kpi-additions).
    urgent_vacancy_count: 3,
    application_pipeline_funnel: REAL_SHAPE_FUNNEL,
    critical_vacancies: REAL_SHAPE_CRITICAL_VACANCIES,
    recent_joins: REAL_SHAPE_RECENT_JOINS,
    recent_resignations: REAL_SHAPE_RECENT_RESIGNATIONS,
    ...overrides,
  }));
}

beforeEach(() => {
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

  it("renders the 3 Sanctioned Strength tiles (approved/working/vacancy) from the API response", async () => {
    mockKpis();

    renderWithProviders();

    expect(screen.getByText("Sanctioned approved")).toBeInTheDocument();
    expect(screen.getByText("Sanctioned working")).toBeInTheDocument();
    expect(screen.getByText("Sanctioned vacancy")).toBeInTheDocument();
    // Unscoped (no category tab selected) values from mockKpis' default --
    // scoped to each tile's own card (not a bare page-wide getByText) since
    // small integers also coincidentally show up as chart axis-tick labels
    // elsewhere on the page; wait for the query to resolve (labels render
    // immediately even while loading, values don't).
    const approvedTile = screen.getByText("Sanctioned approved").closest(".rounded-xl") as HTMLElement;
    const workingTile = screen.getByText("Sanctioned working").closest(".rounded-xl") as HTMLElement;
    const vacancyTile = screen.getByText("Sanctioned vacancy").closest(".rounded-xl") as HTMLElement;
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
    const title = await screen.findByText("Sanctioned vacancy");
    const tile = title.closest(".rounded-xl") as HTMLElement;
    expect(await within(tile).findByText("-4")).toBeInTheDocument();
    expect(within(tile).queryByText("4")).not.toBeInTheDocument();
  });

  it("shows the Sanctioned vacancy tooltip explaining the signed-net meaning", async () => {
    mockKpis();
    renderWithProviders();

    await waitFor(() => expect(screen.getByText("Sanctioned vacancy")).toBeInTheDocument());
    const tooltips = screen.getAllByRole("tooltip");
    expect(tooltips.some((t) => /Negative means net overstaffed overall/.test(t.textContent ?? ""))).toBe(true);
  });

  it("shows the exactly-staffed zero caption on Sanctioned vacancy instead of the generic 'No activity' text", async () => {
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

    // The Sanctioned Strength tiles narrow along with the rest of the KPI
    // strip -- unscoped 25/19/6 replaced by the category-scoped 8/6/2 (see
    // mockKpis' own roleCategory branching above). Scoped to each tile's own
    // card (not a bare page-wide getByText) -- small integers like 8 also
    // coincidentally show up as chart axis-tick labels elsewhere on the page.
    const approvedTile = screen.getByText("Sanctioned approved").closest(".rounded-xl") as HTMLElement;
    const workingTile = screen.getByText("Sanctioned working").closest(".rounded-xl") as HTMLElement;
    const vacancyTile = screen.getByText("Sanctioned vacancy").closest(".rounded-xl") as HTMLElement;
    expect(within(approvedTile).queryByText("25")).not.toBeInTheDocument();
    expect(within(approvedTile).getByText("8")).toBeInTheDocument();
    expect(within(workingTile).getByText("6")).toBeInTheDocument();
    expect(within(vacancyTile).getByText("2")).toBeInTheDocument();

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

  // UI redesign Phase 2: exactly one tile on this page consumes StatTile's
  // `hero` prop (the gradient ring/glow, marked via `data-hero="true"` on
  // the underlying Card) -- total_applications, and no other KPI tile
  // (including the Phase I Sanctioned Strength trio).
  it("marks only the Total applications tile as the hero KPI tile", async () => {
    mockKpis();
    const { container } = renderWithProviders();

    await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());

    const heroTiles = container.querySelectorAll('[data-hero="true"]');
    expect(heroTiles).toHaveLength(1);
    expect(within(heroTiles[0] as HTMLElement).getByText("Total applications")).toBeInTheDocument();
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

  it("shows the Open positions tooltip's precise definition on focus", async () => {
    mockKpis();
    renderWithProviders();

    await waitFor(() => expect(screen.getByText("Open positions")).toBeInTheDocument());
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

    // Source-wise split (empty array), category-wise split (3 rows, all
    // zero -- can't use a `.length === 0` check like the widget beside it),
    // and the recruitment pipeline funnel (all 7 stages zeroed above) all
    // show the same reusable empty-state message here.
    expect(await screen.findAllByText("No applications in this scope yet.")).toHaveLength(3);
    expect(screen.getByText("No rejections or withdrawals in this scope yet.")).toBeInTheDocument();
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

  it("renders the recruitment pipeline funnel's 7 stages in the exact backend order, not re-sorted", async () => {
    mockKpis();

    renderWithProviders();

    const funnelChart = await screen.findByLabelText("Recruitment pipeline funnel");
    // recharts renders each YAxis category tick as its own <text> node --
    // read them back in DOM order and assert against the fixed stage order,
    // not just that all 7 labels are present somewhere.
    const tickTexts = within(funnelChart)
      .getAllByText(/^(Applied|Screening|Interview|Selected|Offer|Joined|Rejected)$/)
      .map((node) => node.textContent);
    expect(tickTexts).toEqual(["Applied", "Screening", "Interview", "Selected", "Offer", "Joined", "Rejected"]);
    // Real counts from the mock, not hard-coded/rendered arbitrarily.
    expect(await within(funnelChart).findByText("143")).toBeInTheDocument();
    expect(within(funnelChart).getByText("53")).toBeInTheDocument();
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

  it("computes Pending requests (SUBMITTED+DEAN_APPROVED) and Pending approvals (+APPROVED) from real listVacancyRequests data, not the /dashboard/kpis response", async () => {
    mockKpis();
    mockedListVacancyRequests.mockResolvedValue(MIXED_STATUS_VACANCY_REQUESTS);

    renderWithProviders();

    // Fetched unfiltered, same as VacancyRequestsListPage's own KPI strip.
    await waitFor(() => expect(mockedListVacancyRequests).toHaveBeenCalledWith(null));

    const pendingRequestsTile = (await screen.findByText("Pending requests")).closest(".rounded-xl") as HTMLElement;
    // 2 SUBMITTED + 1 DEAN_APPROVED = 3 (DRAFT/APPROVED/PUBLISHED/CLOSED/
    // REJECTED all deliberately excluded).
    expect(within(pendingRequestsTile).getByText("3")).toBeInTheDocument();

    const pendingApprovalsTile = screen.getByText("Pending approvals").closest(".rounded-xl") as HTMLElement;
    // Same 3, plus 1 APPROVED ("ready to publish") = 4.
    expect(within(pendingApprovalsTile).getByText("4")).toBeInTheDocument();
  });

  it("shows the Pending requests/approvals zero captions when there are no vacancy requests at all", async () => {
    mockKpis();
    mockedListVacancyRequests.mockResolvedValue([]);

    renderWithProviders();

    expect(await screen.findByText("No requests waiting on an approver right now")).toBeInTheDocument();
    expect(screen.getByText("Nothing awaiting approval or publishing right now")).toBeInTheDocument();
  });
});
