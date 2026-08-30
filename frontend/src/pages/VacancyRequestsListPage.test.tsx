import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as approvedVacanciesApi from "@/api/approvedVacancies";
import * as auditLogsApi from "@/api/auditLogs";
import * as campusesApi from "@/api/campuses";
import { ApiError } from "@/api/client";
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
const mockedSubmitVacancyRequest = vi.mocked(vacancyRequestsApi.submitVacancyRequest);
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
  source: "MANUAL" as const,
  request_ref: null,
  location_id: null,
  required_by: null,
  requester_name: null,
  requester_email: null,
  requester_mobile: null,
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
  supported_categories: [],
  parent_group: null,
  description: null,
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

// "Flat view" (a plain table of every request) is the default render now --
// the parent-group accordion + department-card grid + drill-down detail
// table still exist, just gated behind clicking this Tabs toggle first (see
// VacancyRequestsListPage.tsx's `viewMode` state).
async function switchToGroupedView() {
  await userEvent.click(await screen.findByRole("tab", { name: "Grouped view" }));
}

// The detailed vacancy table (position_title/requester/campus columns) only
// renders once its department's card has actually been clicked (a real
// conditional render, unlike the parent-group accordion which just
// CSS-collapses its always-rendered children) -- tests asserting on that
// detail need to open the department card first. Only meaningful once
// already in grouped view.
async function openDepartmentCard(name: string | RegExp) {
  await userEvent.click(await screen.findByRole("button", { name }));
}

describe("VacancyRequestsListPage", () => {
  it("renders vacancy request rows from the API response in the default flat table", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListVacancyRequests.mockResolvedValue([VR]);
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    ]);

    renderPage();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Assistant Professor")).toBeInTheDocument();
    expect(within(table).getByText("Computer Science")).toBeInTheDocument();
    expect(within(table).getByText("SSE")).toBeInTheDocument();
    expect(within(table).getByText("NORMAL")).toBeInTheDocument(); // PriorityBadge
    expect(within(table).getByText("DRAFT")).toBeInTheDocument(); // StatusBadge
    // No human-readable request-number field exists on VacancyRequestRead --
    // the row shows a short uppercased form of the real id instead.
    expect(within(table).getByTitle("vr-1")).toHaveTextContent("#VR-1");
  });

  it("shows the create button for a CAMPUS_HOD but not for an unrelated role", async () => {
    mockCommonApis();
    mockedListVacancyRequests.mockResolvedValue([]);
    mockedListCampuses.mockResolvedValue([]);

    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    const { unmount } = renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /New request/ })).toBeInTheDocument());
    unmount();

    mockedUseAuth.mockReturnValue({
      user: { role: "INTERVIEW_PANEL_MEMBER" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    renderPage();
    expect(await screen.findByText("No Vacancy Requests Yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New request/ })).not.toBeInTheDocument();
  });

  it("narrows the list client-side by status without re-fetching (KPIs need the full unfiltered set)", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    const submitted = { ...VR, id: "vr-2", status: "SUBMITTED" as const, position_title: "Lecturer" };
    mockedListVacancyRequests.mockResolvedValue([VR, submitted]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage();
    await waitFor(() => expect(mockedListVacancyRequests).toHaveBeenCalledWith(null));
    const callCountBeforeFilter = mockedListVacancyRequests.mock.calls.length;
    expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();

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
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    const cancelled = { ...VR, id: "vr-2", status: "CANCELLED" as const, position_title: "Cancelled Post" };
    mockedListVacancyRequests.mockResolvedValue([VR, cancelled]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage();
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
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    const other = { ...VR, id: "vr-2", campus_id: "c-scad", position_title: "Lab Assistant" };
    mockedListVacancyRequests.mockResolvedValue([VR, other]);
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
      { id: "c-scad", code: "SCAD", name: "SCAD Campus", is_active: true, created_at: "", updated_at: "" },
    ]);

    renderPage();
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
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    const other = { ...VR, id: "vr-2", campus_id: "c-sse", position_title: "Lab Assistant" };
    mockedListVacancyRequests.mockResolvedValue([VR, other]);
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    ]);

    renderPage();
    expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Search position"), "lab");

    expect(screen.queryByText("Assistant Professor")).not.toBeInTheDocument();
    expect(screen.getByText("Lab Assistant")).toBeInTheDocument();
  });

  it("shows a filters-specific empty state (Clear-filters CTA) distinct from the no-data-at-all empty state (Create CTA)", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListVacancyRequests.mockResolvedValue([VR]);
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    ]);

    renderPage();
    expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Search position"), "nonexistent");

    const emptyState = (await screen.findByText("No matching vacancy requests")).closest("div");
    expect(within(emptyState!).getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
    // This CAMPUS_HOD *can* create requests, but a filtered-to-zero result
    // still gets the Clear-filters CTA, never the Create CTA (see
    // emptyStateTitle/hasAnyFilter branching in the page component).
    expect(within(emptyState!).queryByRole("link", { name: /Create Vacancy Request/ })).not.toBeInTheDocument();
  });

  it("shows the no-data-at-all empty state (Create CTA, no Clear-filters button) when there are no requests and no filters applied", async () => {
    mockCommonApis();
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListVacancyRequests.mockResolvedValue([]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage();

    const emptyState = (await screen.findByText("No Vacancy Requests Yet")).closest("div");
    expect(within(emptyState!).getByRole("link", { name: /Create Vacancy Request/ })).toBeInTheDocument();
    expect(within(emptyState!).queryByRole("button")).not.toBeInTheDocument();
  });

  it("the top-bar Clear filters button resets every active filter back to All/empty", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    const submitted = { ...VR, id: "vr-2", status: "SUBMITTED" as const, position_title: "Lecturer" };
    mockedListVacancyRequests.mockResolvedValue([VR, submitted]);
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    ]);

    renderPage();
    expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Search position"), "assistant");
    expect(screen.queryByText("Lecturer")).not.toBeInTheDocument();
    expect(screen.getByText("1 filter applied")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(screen.getByPlaceholderText("Search position")).toHaveValue("");
    expect(await screen.findByText("Lecturer")).toBeInTheDocument();
    expect(screen.getByText("Assistant Professor")).toBeInTheDocument();
    expect(screen.queryByText(/filter(s)? applied/)).not.toBeInTheDocument();
  });

  it("submits a DRAFT request from the row's inline Submit action and clears any prior row error on success", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListVacancyRequests.mockResolvedValue([VR]); // VR.status === "DRAFT"
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    ]);
    mockedSubmitVacancyRequest.mockResolvedValue({ ...VR, status: "SUBMITTED" });

    renderPage();
    expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(mockedSubmitVacancyRequest).toHaveBeenCalledWith("vr-1"));
    expect(screen.queryByText(/submit failed/i)).not.toBeInTheDocument();
  });

  it("surfaces a row-level error message when the inline Submit action fails", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListVacancyRequests.mockResolvedValue([VR]);
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    ]);
    mockedSubmitVacancyRequest.mockRejectedValue(new ApiError(409, "Only 0 posts available to request"));

    renderPage();
    expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByText("Only 0 posts available to request")).toBeInTheDocument();
  });

  it("renders KPI tiles reflecting the full unfiltered set", async () => {
    mockCommonApis();
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    const submitted = { ...VR, id: "vr-2", status: "SUBMITTED" as const, position_title: "Lecturer" };
    const rejected = { ...VR, id: "vr-3", status: "REJECTED" as const, position_title: "Guest Lecturer" };
    mockedListVacancyRequests.mockResolvedValue([VR, submitted, rejected]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage();

    // 3 total, 1 draft, 1 pending (SUBMITTED), 1 rejected -- each tile shows its count.
    // Label -> CardHeader -> Card (the tile's own container), not a sibling tile.
    // Renamed to "Total Requests" on 2026-08-30 with the primary row cut to
    // the six the brief names.
    const totalTile = (await screen.findByText("Total Requests")).parentElement?.parentElement;
    await waitFor(() => expect(totalTile).toHaveTextContent("3"));

    const rejectedTile = screen.getByText("Rejected").parentElement?.parentElement;
    expect(rejectedTile).toHaveTextContent("1");

    // Urgent and QR Submitted are orthogonal to status, so they are computed
    // separately from the status buckets -- both zero for this fixture set,
    // which is all MANUAL and NORMAL priority.
    const qrTile = screen.getByText("QR Submitted").parentElement?.parentElement;
    expect(qrTile).toHaveTextContent("0");
  });

  it("counts QR-submitted and urgent requests on their own tiles", async () => {
    mockCommonApis();
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    const fromQr = { ...VR, id: "vr-qr", source: "QR" as const, request_ref: "VR-2026-000001" };
    const urgent = { ...VR, id: "vr-urgent", priority: "URGENT" as const };
    mockedListVacancyRequests.mockResolvedValue([VR, fromQr, urgent]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage();

    const qrTile = (await screen.findByText("QR Submitted")).parentElement?.parentElement;
    await waitFor(() => expect(qrTile).toHaveTextContent("1"));

    const urgentTile = screen.getByText("Urgent").parentElement?.parentElement;
    expect(urgentTile).toHaveTextContent("1");
  });

  it("filters the table by Source", async () => {
    mockCommonApis();
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    const fromQr = {
      ...VR,
      id: "vr-qr",
      source: "QR" as const,
      position_title: "Scanned Request",
      request_ref: "VR-2026-000001",
    };
    mockedListVacancyRequests.mockResolvedValue([VR, fromQr]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage();
    await screen.findByText("Scanned Request");

    await userEvent.click(screen.getByRole("combobox", { name: "Source filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "QR" }));

    await waitFor(() => expect(screen.queryByText(VR.position_title)).not.toBeInTheDocument());
    expect(screen.getByText("Scanned Request")).toBeInTheDocument();
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
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListVacancyRequests.mockResolvedValue([VR]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage();
    expect(screen.getByRole("combobox", { name: "Requested by filter" })).toBeInTheDocument();

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
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListVacancyRequests.mockResolvedValue([VR]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage();
    expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();

    expect(mockedListUsers).toHaveBeenCalledTimes(callCountBefore);
    expect(screen.queryByRole("combobox", { name: "Requested by filter" })).not.toBeInTheDocument();
  });

  it("defaults to the All tab, then narrows to Non-Teaching, showing only the matching role_category's rows", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([
      DEPARTMENT,
      { ...DEPARTMENT, id: "d-2", name: "Housekeeping Services" },
    ]);
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
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

    // "All" (the URL-absent default) shows both requests' rows.
    expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();
    expect(screen.getByText("Office Assistant")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "All (2)" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /^Non-Teaching/ }));

    expect(await screen.findByText("Office Assistant")).toBeInTheDocument();
    expect(screen.queryByText("Assistant Professor")).not.toBeInTheDocument();
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
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
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
    expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();
    expect(screen.getByText("Lecturer (SCAD)")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));

    // Teaching + campus=SSE applies both -- SCAD's TEACHING request drops out.
    expect(screen.getByText("Assistant Professor")).toBeInTheDocument();
    expect(screen.queryByText("Lecturer (SCAD)")).not.toBeInTheDocument();
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
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
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

    expect(await screen.findByText("Lecturer in Physics")).toBeInTheDocument();
    expect(screen.queryByText("Assistant Professor")).not.toBeInTheDocument();
  });

  it("(grouped view) groups requests into a department card (inside the 'Ungrouped' parent-group accordion) showing aggregated counts, detail table closed by default", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    const submitted = { ...VR, id: "vr-2", status: "SUBMITTED" as const, position_title: "Lecturer" };
    mockedListVacancyRequests.mockResolvedValue([VR, submitted]);
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    ]);

    renderPage();
    await switchToGroupedView();

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

  it("(grouped view) computes per-row filled/remaining counts from the approved-vacancy -> job-posting bridge", async () => {
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
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListVacancyRequests.mockResolvedValue([VR]);
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    ]);

    renderPage();
    await switchToGroupedView();
    await openDepartmentCard(/Computer Science/);

    // "Assistant Professor" is the designation group heading, not a row
    // cell -- the row itself lives in the table nested under it.
    const designationGroup = (await screen.findByText("Assistant Professor")).closest("div");
    const row = designationGroup?.querySelector("table tbody tr");
    // requested=1 (still needed), available=1 (filled) -> filled=1, remaining=1.
    expect(row).toHaveTextContent(/2.*1.*1/);
  });

  it("(grouped view) filters department cards by Parent Group, bucketing departments without one under 'Ungrouped'", async () => {
    mockCommonApis();
    mockedListDepartments.mockResolvedValue([
      DEPARTMENT,
      { ...DEPARTMENT, id: "d-2", name: "Mathematics", parent_group: "School of Sciences" },
    ]);
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    const mathsRequest = { ...VR, id: "vr-2", department_id: "d-2", position_title: "Lecturer in Mathematics" };
    mockedListVacancyRequests.mockResolvedValue([VR, mathsRequest]);
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    ]);

    renderPage();
    await switchToGroupedView();

    expect(await screen.findByRole("button", { name: /Ungrouped/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /School of Sciences/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Parent group filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "School of Sciences" }));

    expect(await screen.findByRole("button", { name: /School of Sciences/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Ungrouped/ })).not.toBeInTheDocument();
  });
});
