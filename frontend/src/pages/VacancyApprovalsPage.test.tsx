import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import * as campusesApi from "@/api/campuses";
import * as departmentsApi from "@/api/departments";
import type { DepartmentRead, UserRead, VacancyRequestRead } from "@/api/types";
import * as vacancyRequestsApi from "@/api/vacancyRequests";
import * as authContext from "@/auth/AuthContext";
import { ToastProvider } from "@/components/ui/toast";
import { VacancyApprovalsPage } from "@/pages/VacancyApprovalsPage";

vi.mock("@/api/vacancyRequests");
vi.mock("@/api/campuses");
vi.mock("@/api/departments");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListVacancyRequests = vi.mocked(vacancyRequestsApi.listVacancyRequests);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedListDepartments = vi.mocked(departmentsApi.listDepartments);
const mockedDeanApprove = vi.mocked(vacancyRequestsApi.deanApproveVacancyRequest);
const mockedHrApprove = vi.mocked(vacancyRequestsApi.hrApproveVacancyRequest);
const mockedPublish = vi.mocked(vacancyRequestsApi.publishVacancyRequest);
const mockedReject = vi.mocked(vacancyRequestsApi.rejectVacancyRequest);

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
    requested_by_name: "Test User",
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

// Wrapped in ToastProvider -- the page's mutations now call useToast()
// (design-system-foundation step 5), which throws if rendered outside one.
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <VacancyApprovalsPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockQueue(byStatus: Partial<Record<VacancyRequestRead["status"], VacancyRequestRead[]>>) {
  mockedListVacancyRequests.mockImplementation(async (status) => {
    if (!status) return [];
    return byStatus[status] ?? [];
  });
}

describe("VacancyApprovalsPage", () => {
  beforeEach(() => {
    // The page reads departments for its Department column and filter. Every
    // case that cares overrides this; the rest just need it not to hit the
    // network.
    mockedListDepartments.mockResolvedValue([]);
  });

  it("shows a scope message for a role outside the approval chain", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue([]);
    mockQueue({});

    renderPage();

    expect(await screen.findByText("Your role doesn't take part in the approval chain.")).toBeInTheDocument();
  });

  // RBAC permission-gate audit (2026-08-24): reject/publish are gated by
  // require_permission(REJECT_VACANCY)/require_permission(PUBLISH_VACANCY),
  // not ACTIONABLE_STATUSES_BY_ROLE alone -- this locks in the fix (a role
  // completely outside the table, e.g. a RECRUITMENT_OFFICER, individually
  // granted PUBLISH_VACANCY now sees the APPROVED queue and a working
  // Publish button) without changing the "scope message" test above (no
  // grant passed there, so it behaves exactly as before).
  it("shows the APPROVED queue and Publish to a role outside the approval chain individually granted PUBLISH_VACANCY", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "RECRUITMENT_OFFICER" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
      hasPermission: (permission) => permission === "PUBLISH_VACANCY",
    });
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    ]);
    mockQueue({ APPROVED: [makeVR({ status: "APPROVED" })] });

    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument());
  });

  it("shows Dean-approve and Reject for a SUBMITTED request as Associate Dean", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "ASSOCIATE_DEAN_RECRUITMENT" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    ]);
    mockQueue({ SUBMITTED: [makeVR({})] });

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "Dean-approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "HR-approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();

    mockedDeanApprove.mockResolvedValue(makeVR({ status: "DEAN_APPROVED" }));
    await userEvent.click(screen.getByRole("button", { name: "Dean-approve" }));

    await waitFor(() => expect(mockedDeanApprove).toHaveBeenCalledWith("vr-1"));
    // Design-system-foundation step 5: a success toast on every action's
    // onSuccess, where before this page showed no feedback at all on success.
    expect(await screen.findByRole("status")).toHaveTextContent("Vacancy request dean-approved.");
  });

  it("shows HR-approve for DEAN_APPROVED and Publish for APPROVED as HR Admin", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
    ]);
    mockQueue({
      DEAN_APPROVED: [makeVR({ id: "vr-2", position_title: "Lab Assistant", status: "DEAN_APPROVED" })],
      APPROVED: [makeVR({ id: "vr-3", position_title: "Lecturer", status: "APPROVED" })],
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("Lab Assistant")).toBeInTheDocument());
    expect(screen.getByText("Lecturer")).toBeInTheDocument();

    const rows = screen.getAllByRole("row");
    const labRow = rows.find((r) => r.textContent?.includes("Lab Assistant"))!;
    const lecturerRow = rows.find((r) => r.textContent?.includes("Lecturer"))!;

    expect(within(labRow).getByRole("button", { name: "HR-approve" })).toBeInTheDocument();
    expect(within(labRow).getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(within(lecturerRow).getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(within(lecturerRow).queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();

    mockedHrApprove.mockResolvedValue({
      id: "av-1",
      vacancy_request_id: "vr-2",
      campus_id: "c-sse",
      total_positions: 2,
      approved_by_id: "u-hr",
      approved_at: "2026-07-30T00:00:00Z",
      closed_at: null,
      created_at: "2026-07-30T00:00:00Z",
      updated_at: "2026-07-30T00:00:00Z",
    });
    await userEvent.click(within(labRow).getByRole("button", { name: "HR-approve" }));
    await waitFor(() => expect(mockedHrApprove).toHaveBeenCalledWith("vr-2"));
    expect(await screen.findByText("Vacancy request HR-approved.")).toBeInTheDocument();

    mockedPublish.mockResolvedValue({
      id: "jp-1",
      approved_vacancy_id: "av-1",
      campus_id: "c-sse",
      role_category: "TEACHING",
      public_apply_slug: "sse-lecturer-abcd",
      published_at: "2026-07-30T00:00:00Z",
      closed_at: null,
      is_active: true,
      position_title: "Lecturer",
      department_id: "d-sse",
      requested_count: 2,
      available_count: 0,
      created_at: "2026-07-30T00:00:00Z",
      updated_at: "2026-07-30T00:00:00Z",
    });
    await userEvent.click(within(lecturerRow).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(mockedPublish).toHaveBeenCalledWith("vr-3"));
    expect(await screen.findByText("Vacancy request published.")).toBeInTheDocument();
  });

  it("sorts the queue by priority first, then by how long each request has been waiting", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue([]);
    mockQueue({
      SUBMITTED: [
        makeVR({ id: "vr-old-normal", position_title: "Old Normal", priority: "NORMAL", submitted_at: "2026-07-01T00:00:00Z" }),
        makeVR({ id: "vr-new-urgent", position_title: "New Urgent", priority: "URGENT", submitted_at: "2026-07-25T00:00:00Z" }),
        makeVR({ id: "vr-new-normal", position_title: "New Normal", priority: "NORMAL", submitted_at: "2026-07-20T00:00:00Z" }),
      ],
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("New Urgent")).toBeInTheDocument());

    const positionCells = screen.getAllByRole("link").map((el) => el.textContent);
    expect(positionCells).toEqual(["New Urgent", "Old Normal", "New Normal"]);
  });

  it("rejects a request with a required reason via the dialog", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "ASSOCIATE_DEAN_RECRUITMENT" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue([]);
    mockQueue({ SUBMITTED: [makeVR({})] });
    mockedReject.mockResolvedValue(makeVR({ status: "REJECTED" }));

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    const confirmButton = await screen.findByRole("button", { name: "Confirm reject" });
    expect(confirmButton).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Reason"), "Position no longer needed");
    expect(confirmButton).toBeEnabled();
    await userEvent.click(confirmButton);

    await waitFor(() => expect(mockedReject).toHaveBeenCalledWith("vr-1", "Position no longer needed"));
    expect(await screen.findByText("Vacancy request rejected.")).toBeInTheDocument();
    // The reject dialog itself closes on success (rejectingId reset to null).
    expect(screen.queryByRole("button", { name: "Confirm reject" })).not.toBeInTheDocument();
  });

  it("shows the Over-sanction badge next to a request's position title when is_over_sanction is true", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "ASSOCIATE_DEAN_RECRUITMENT" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue([]);
    mockQueue({ SUBMITTED: [makeVR({ is_over_sanction: true })] });

    renderPage();

    expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();
    expect(screen.getByText("Over-sanction")).toBeInTheDocument();
  });

  it("shows an error toast (not the old inline banner) when an approval action fails", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "ASSOCIATE_DEAN_RECRUITMENT" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue([]);
    mockQueue({ SUBMITTED: [makeVR({})] });
    mockedDeanApprove.mockRejectedValue(new ApiError(409, "Cannot Dean-approve from status SUBMITTED"));

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Dean-approve" }));

    // Design-system-foundation step 5: the backend's own error message now
    // surfaces via toast.tsx's `role="status"` stack, replacing the old
    // `<p className="text-destructive">{actionError}</p>` inline banner.
    expect(await screen.findByRole("status")).toHaveTextContent("Cannot Dean-approve from status SUBMITTED");
  });
  // --- Summary tiles, filters and the widened gate (2026-09-01) -----------

  it("summarises the whole picture in four tiles, unaffected by the filters", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
      { id: "c-scad", code: "SCAD", name: "SCAD Campus", is_active: true, created_at: "", updated_at: "" },
    ]);
    mockQueue({
      SUBMITTED: [makeVR({ id: "vr-1" })],
      DEAN_APPROVED: [makeVR({ id: "vr-2", status: "DEAN_APPROVED" })],
      APPROVED: [makeVR({ id: "vr-3", status: "APPROVED" })],
      REJECTED: [
        makeVR({ id: "vr-4", status: "REJECTED" }),
        makeVR({ id: "vr-5", status: "REJECTED" }),
      ],
    });

    renderPage();

    // Label -> CardHeader -> Card (the tile's own container), the same walk
    // VacancyRequestsListPage's tile assertions use.
    const pendingTile = (await screen.findByText("Pending")).parentElement?.parentElement;
    await waitFor(() => expect(pendingTile).toHaveTextContent("2"));
    expect(screen.getByText("Approved").parentElement?.parentElement).toHaveTextContent("1");
    expect(screen.getByText("Rejected").parentElement?.parentElement).toHaveTextContent("2");
    expect(screen.getByText("Total").parentElement?.parentElement).toHaveTextContent("5");
  });

  it("narrows the queue client-side by campus without refetching", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
      { id: "c-scad", code: "SCAD", name: "SCAD Campus", is_active: true, created_at: "", updated_at: "" },
    ]);
    mockQueue({
      SUBMITTED: [
        makeVR({ id: "vr-sse", position_title: "Assistant Professor", campus_id: "c-sse" }),
        makeVR({ id: "vr-scad", position_title: "Lab Assistant", campus_id: "c-scad" }),
      ],
    });

    renderPage();
    expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();
    expect(screen.getByText("Lab Assistant")).toBeInTheDocument();
    const callsBefore = mockedListVacancyRequests.mock.calls.length;

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SCAD" }));

    expect(screen.queryByText("Assistant Professor")).not.toBeInTheDocument();
    expect(screen.getByText("Lab Assistant")).toBeInTheDocument();
    // Client-side, exactly like VacancyRequestsListPage's own campus filter --
    // GET /vacancy-requests has no campus_id parameter to push this down to.
    expect(mockedListVacancyRequests).toHaveBeenCalledTimes(callsBefore);
  });

  it("narrows the queue by the date the request was raised", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue([]);
    mockQueue({
      SUBMITTED: [
        makeVR({ id: "vr-jun", position_title: "June Request", created_at: "2026-06-10T00:00:00Z" }),
        makeVR({ id: "vr-jul", position_title: "July Request", created_at: "2026-07-19T00:00:00Z" }),
      ],
    });

    renderPage();
    expect(await screen.findByText("June Request")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Raised from"), { target: { value: "2026-07-01" } });

    expect(screen.queryByText("June Request")).not.toBeInTheDocument();
    expect(screen.getByText("July Request")).toBeInTheDocument();
  });

  it("says there is nothing pending when the queue is empty, and says so differently when a filter emptied it", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "ASSOCIATE_DEAN_RECRUITMENT" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue([
      { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" },
      { id: "c-scad", code: "SCAD", name: "SCAD Campus", is_active: true, created_at: "", updated_at: "" },
    ]);
    mockQueue({});

    const { unmount } = renderPage();
    expect(await screen.findByText("No pending vacancy approvals")).toBeInTheDocument();
    unmount();

    mockQueue({ SUBMITTED: [makeVR({ campus_id: "c-sse" })] });
    renderPage();
    expect(await screen.findByText("Assistant Professor")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SCAD" }));

    expect(screen.getByText("No vacancy approvals match these filters.")).toBeInTheDocument();
  });

  it("shows the SUBMITTED queue and Dean-approve to a role outside the chain granted APPROVE_VACANCY", async () => {
    // Mirrors 6c010d4's backend gate: dean-approve is
    // require_roles_or_permission(APPROVE_VACANCY, ...), so the grant alone is
    // enough. hr-approve deliberately is NOT, which the next assertion pins.
    mockedUseAuth.mockReturnValue({
      user: { role: "RECRUITMENT_OFFICER" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
      hasPermission: (permission) => permission === "APPROVE_VACANCY",
    });
    mockedListCampuses.mockResolvedValue([]);
    mockQueue({
      SUBMITTED: [makeVR({})],
      DEAN_APPROVED: [makeVR({ id: "vr-2", position_title: "Lab Assistant", status: "DEAN_APPROVED" })],
    });

    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: "Dean-approve" })).toBeInTheDocument());
    // DEAN_APPROVED is not in this user's queue at all: APPROVE_VACANCY
    // unlocks the Dean stage only.
    expect(screen.queryByText("Lab Assistant")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "HR-approve" })).not.toBeInTheDocument();
  });

  it("shows who raised each request, and its ref and department", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "ASSOCIATE_DEAN_RECRUITMENT" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue([]);
    mockedListDepartments.mockResolvedValue([{ id: "d-1", name: "Computer Science" } as DepartmentRead]);
    mockQueue({
      SUBMITTED: [
        makeVR({ request_ref: "VR-2026-0012", requested_by_name: "Dr Ramesh Kumar", department_id: "d-1" }),
      ],
    });

    renderPage();

    expect(await screen.findByText("Dr Ramesh Kumar")).toBeInTheDocument();
    expect(screen.getByText("VR-2026-0012")).toBeInTheDocument();
    expect(screen.getByText("Computer Science")).toBeInTheDocument();
    expect(screen.getByText("Teaching")).toBeInTheDocument();
  });
});
