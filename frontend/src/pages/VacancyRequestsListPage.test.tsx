import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as approvedVacanciesApi from "@/api/approvedVacancies";
import * as auditLogsApi from "@/api/auditLogs";
import * as campusesApi from "@/api/campuses";
import * as departmentsApi from "@/api/departments";
import * as jobPostingsApi from "@/api/jobPostings";
import type { DepartmentRead, UserRead, VacancyRequestRead } from "@/api/types";
import * as usersApi from "@/api/users";
import * as vacancyRequestsApi from "@/api/vacancyRequests";
import * as authContext from "@/auth/AuthContext";
import { VacancyRequestsListPage } from "@/pages/VacancyRequestsListPage";

vi.mock("@/api/vacancyRequests");
vi.mock("@/api/campuses");
vi.mock("@/api/departments");
vi.mock("@/api/jobPostings");
vi.mock("@/api/approvedVacancies");
vi.mock("@/api/users");
vi.mock("@/api/auditLogs");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListVacancyRequests = vi.mocked(vacancyRequestsApi.listVacancyRequests);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedListDepartments = vi.mocked(departmentsApi.listDepartments);
const mockedListJobPostings = vi.mocked(jobPostingsApi.listJobPostings);
const mockedListApprovedVacancies = vi.mocked(approvedVacanciesApi.listApprovedVacancies);
const mockedListUsers = vi.mocked(usersApi.listUsers);
const mockedListAuditLogs = vi.mocked(auditLogsApi.listAuditLogs);

const VR: VacancyRequestRead = {
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
  status: "DRAFT",
  requested_by_id: "u-1",
  submitted_at: null,
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
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const DEPARTMENT: DepartmentRead = {
  id: "d-1",
  campus_id: "c-sse",
  name: "Computer Science",
  code: null,
  category: null,
  parent_group: null,
  is_active: true,
  created_at: "",
  updated_at: "",
};

function renderPage(initialPath = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <VacancyRequestsListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockCommonApis() {
  mockedListDepartments.mockResolvedValue([]);
  mockedListJobPostings.mockResolvedValue([]);
  mockedListApprovedVacancies.mockResolvedValue([]);
  mockedListUsers.mockResolvedValue([]);
  mockedListAuditLogs.mockResolvedValue([]);
}

// The detailed vacancy table (position_title/requester/campus columns) only
// renders once its department's card has actually been clicked (a real
// conditional render, unlike the parent-group accordion which just
// CSS-collapses its always-rendered children) -- tests asserting on that
// detail need to open the department card first.
async function openDepartmentCard(name: string | RegExp) {
  await userEvent.click(await screen.findByRole("button", { name }));
}

describe("VacancyRequestsListPage", () => {
  it("renders rows from the API response", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedListVacancyRequests.mockResolvedValue([VR]);
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: /Computer Science/ })).toBeInTheDocument());
    await openDepartmentCard(/Computer Science/);

    expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();
    expect(screen.getByText("SSE")).toBeInTheDocument();
  });

  it("shows the create button for a CAMPUS_HOD but not for an unrelated role", async () => {
    mockCommonApis();
    mockedListVacancyRequests.mockResolvedValue([]);
    mockedListCampuses.mockResolvedValue([]);

    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    const { unmount } = renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /New request/ })).toBeInTheDocument());
    unmount();

    mockedUseAuth.mockReturnValue({
      user: { role: "INTERVIEW_PANEL_MEMBER" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/No vacancy requests/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /New request/ })).not.toBeInTheDocument();
  });

  it("narrows the list client-side by status without re-fetching (KPIs need the full unfiltered set)", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    const submitted = { ...VR, id: "vr-2", status: "SUBMITTED" as const, position_title: "Lecturer" };
    mockedListVacancyRequests.mockResolvedValue([VR, submitted]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage();
    await waitFor(() => expect(mockedListVacancyRequests).toHaveBeenCalledWith(null));
    const callCountBeforeFilter = mockedListVacancyRequests.mock.calls.length;
    await openDepartmentCard(/Computer Science/);

    await userEvent.click(screen.getByRole("combobox", { name: "Status filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SUBMITTED" }));

    expect(await screen.findByText("Lecturer")).toBeInTheDocument();
    expect(screen.queryByText("Assistant Professor")).not.toBeInTheDocument();
    expect(mockedListVacancyRequests).toHaveBeenCalledTimes(callCountBeforeFilter);
  });

  it("offers CANCELLED as a status filter option", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    const cancelled = { ...VR, id: "vr-2", status: "CANCELLED" as const, position_title: "Cancelled Post" };
    mockedListVacancyRequests.mockResolvedValue([VR, cancelled]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage();
    await openDepartmentCard(/Computer Science/);
    expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Status filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "CANCELLED" }));

    expect(await screen.findByText("Cancelled Post")).toBeInTheDocument();
    expect(screen.queryByText("Assistant Professor")).not.toBeInTheDocument();
  });

  it("narrows the list client-side by campus without re-fetching", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    const other = { ...VR, id: "vr-2", campus_id: "c-scad", position_title: "Lab Assistant" };
    mockedListVacancyRequests.mockResolvedValue([VR, other]);
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
      { id: "c-scad", code: "SCAD", name: "SCAD Campus", is_active: true, created_at: "", updated_at: "" },
    ]);

    renderPage();
    await openDepartmentCard(/Computer Science/);
    expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();
    expect(screen.getByText("Lab Assistant")).toBeInTheDocument();
    const callCountBeforeFilter = mockedListVacancyRequests.mock.calls.length;

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SCAD" }));

    expect(screen.queryByText("Assistant Professor")).not.toBeInTheDocument();
    expect(screen.getByText("Lab Assistant")).toBeInTheDocument();
    expect(mockedListVacancyRequests).toHaveBeenCalledTimes(callCountBeforeFilter);
  });

  it("narrows the list client-side by a position-title search", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    const other = { ...VR, id: "vr-2", campus_id: "c-sse", position_title: "Lab Assistant" };
    mockedListVacancyRequests.mockResolvedValue([VR, other]);
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    ]);

    renderPage();
    await openDepartmentCard(/Computer Science/);
    expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Search position"), "lab");

    expect(screen.queryByText("Assistant Professor")).not.toBeInTheDocument();
    expect(screen.getByText("Lab Assistant")).toBeInTheDocument();
  });

  it("shows a filters-specific empty state when filters narrow a non-empty list to zero", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedListVacancyRequests.mockResolvedValue([VR]);
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    ]);

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Computer Science/ })).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText("Search position"), "nonexistent");

    expect(await screen.findByText("No vacancy requests match these filters.")).toBeInTheDocument();
  });

  it("renders KPI tiles reflecting the full unfiltered set", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    const submitted = { ...VR, id: "vr-2", status: "SUBMITTED" as const, position_title: "Lecturer" };
    const rejected = { ...VR, id: "vr-3", status: "REJECTED" as const, position_title: "Guest Lecturer" };
    mockedListVacancyRequests.mockResolvedValue([VR, submitted, rejected]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("Total requests")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /Computer Science/ })).toBeInTheDocument());
    // 3 total, 1 draft, 1 pending (SUBMITTED), 1 rejected -- each tile shows its count.
    // Label -> CardHeader -> Card (the tile's own container), not a sibling tile.
    const totalTile = screen.getByText("Total requests").parentElement?.parentElement;
    expect(totalTile).toHaveTextContent("3");
  });

  it("resolves requester names and offers a Requested by filter for HR Admin", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListUsers.mockResolvedValue([
      { id: "u-1", full_name: "Priya HOD" } as UserRead,
    ]);
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedListVacancyRequests.mockResolvedValue([VR]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage();
    expect(screen.getByRole("combobox", { name: "Requested by filter" })).toBeInTheDocument();
    await openDepartmentCard(/Computer Science/);

    expect(await screen.findByText("Priya HOD")).toBeInTheDocument();
  });

  it("does not attempt to resolve requester names for a role without user-list access", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    // Vitest doesn't clear mocks between tests in this file -- an earlier
    // HR_ADMIN test already called listUsers, so assert no *new* call
    // happens here rather than an absolute zero-calls count.
    const callCountBefore = mockedListUsers.mock.calls.length;
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedListVacancyRequests.mockResolvedValue([VR]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Computer Science/ })).toBeInTheDocument());

    expect(mockedListUsers).toHaveBeenCalledTimes(callCountBefore);
    expect(screen.queryByRole("combobox", { name: "Requested by filter" })).not.toBeInTheDocument();
  });

  it("groups requests into a department card (inside the 'Ungrouped' parent-group accordion) showing aggregated counts, detail table closed by default", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    const submitted = { ...VR, id: "vr-2", status: "SUBMITTED" as const, position_title: "Lecturer" };
    mockedListVacancyRequests.mockResolvedValue([VR, submitted]);
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    ]);

    renderPage();

    // Departments without a parent_group land in a fixed "Ungrouped" bucket.
    expect(await screen.findByRole("button", { name: /Ungrouped/ })).toBeInTheDocument();

    const card = await screen.findByRole("button", { name: /Computer Science/ });
    expect(card).toHaveTextContent("2"); // total
    expect(card).toHaveTextContent("1"); // pending
    expect(card).toHaveAttribute("aria-pressed", "false");
    // The detailed vacancy table (position_title headings) isn't in the DOM
    // until the department card is clicked.
    expect(screen.queryByText("Assistant Professor")).not.toBeInTheDocument();

    await userEvent.click(card);
    expect(card).toHaveAttribute("aria-pressed", "true");
    // Grouped under role category and designation once expanded.
    expect(screen.getByText("TEACHING")).toBeInTheDocument();
    expect(screen.getByText("Assistant Professor")).toBeInTheDocument();
    expect(screen.getByText("Lecturer")).toBeInTheDocument();
  });

  it("computes per-row filled/remaining counts from the approved-vacancy -> job-posting bridge", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedListApprovedVacancies.mockResolvedValue([
      {
        id: "av-1",
        vacancy_request_id: "vr-1",
        campus_id: "c-sse",
        total_positions: 2,
        approved_by_id: "u-2",
        approved_at: "2026-01-01T00:00:00Z",
        closed_at: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    mockedListJobPostings.mockResolvedValue([
      {
        id: "jp-1",
        approved_vacancy_id: "av-1",
        campus_id: "c-sse",
        role_category: "TEACHING",
        public_apply_slug: "assistant-professor",
        published_at: "2026-01-02T00:00:00Z",
        closed_at: null,
        is_active: true,
        created_at: "2026-01-02T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        position_title: "Assistant Professor",
        department_id: "d-1",
        requested_count: 1,
        available_count: 1,
      },
    ]);
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedListVacancyRequests.mockResolvedValue([VR]);
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    ]);

    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /Computer Science/ }));

    // "Assistant Professor" is the designation group heading, not a row
    // cell -- the row itself lives in the table nested under it.
    const designationGroup = (await screen.findByText("Assistant Professor")).closest("div");
    const row = designationGroup?.querySelector("table tbody tr");
    // requested=1 (still needed), available=1 (filled) -> filled=1, remaining=1.
    expect(row).toHaveTextContent(/2.*1.*1/);
  });

  it("defaults to the All tab, then narrows to Non-Teaching, showing only the matching role_category's departments", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([
      DEPARTMENT,
      { ...DEPARTMENT, id: "d-2", name: "Housekeeping Services" },
    ]);
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    const nonTeaching = {
      ...VR,
      id: "vr-2",
      department_id: "d-2",
      role_category: "NON_TEACHING" as const,
      position_title: "Office Assistant",
    };
    mockedListVacancyRequests.mockResolvedValue([VR, nonTeaching]);
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    ]);

    renderPage();

    // "All" (the URL-absent default) shows both departments' cards.
    expect(await screen.findByRole("button", { name: /Computer Science/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Housekeeping Services/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "All (2)" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /^Non-Teaching/ }));

    expect(await screen.findByRole("button", { name: /Housekeeping Services/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Computer Science/ })).not.toBeInTheDocument();
  });

  it("combines the category tab with the campus filter (both apply, not just one)", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([
      DEPARTMENT,
      { ...DEPARTMENT, id: "d-2", name: "Physics", campus_id: "c-scad" },
    ]);
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    // Both TEACHING -- one at SSE, one at SCAD.
    const scadTeaching = {
      ...VR,
      id: "vr-2",
      department_id: "d-2",
      campus_id: "c-scad",
      position_title: "Lecturer (SCAD)",
    };
    mockedListVacancyRequests.mockResolvedValue([VR, scadTeaching]);
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
      { id: "c-scad", code: "SCAD", name: "SCAD Campus", is_active: true, created_at: "", updated_at: "" },
    ]);

    renderPage();

    await userEvent.click(await screen.findByRole("tab", { name: /^Teaching/ }));
    expect(await screen.findByRole("button", { name: /Computer Science/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Physics/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));

    // Teaching + campus=SSE applies both -- SCAD's TEACHING department drops out.
    expect(screen.getByRole("button", { name: /Computer Science/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Physics/ })).not.toBeInTheDocument();
  });

  it("pre-filters by ?department=&designation= on mount (Phase E items 28/29 deep links from Sanctioned Strength)", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([
      DEPARTMENT,
      { ...DEPARTMENT, id: "d-2", name: "Physics" },
    ]);
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    const physicsRequest = {
      ...VR,
      id: "vr-2",
      department_id: "d-2",
      designation_id: "desg-2",
      position_title: "Lecturer in Physics",
    };
    mockedListVacancyRequests.mockResolvedValue([VR, physicsRequest]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage("/?department=d-2&designation=desg-2");

    expect(await screen.findByRole("button", { name: /Physics/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Computer Science/ })).not.toBeInTheDocument();
  });

  it("filters department cards by Parent Group, bucketing departments without one under 'Ungrouped'", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([
      DEPARTMENT,
      { ...DEPARTMENT, id: "d-2", name: "Mathematics", parent_group: "School of Sciences" },
    ]);
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    const mathsRequest = { ...VR, id: "vr-2", department_id: "d-2", position_title: "Lecturer in Mathematics" };
    mockedListVacancyRequests.mockResolvedValue([VR, mathsRequest]);
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    ]);

    renderPage();

    expect(await screen.findByRole("button", { name: /Ungrouped/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /School of Sciences/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Parent group filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "School of Sciences" }));

    expect(await screen.findByRole("button", { name: /School of Sciences/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Ungrouped/ })).not.toBeInTheDocument();
  });
});
