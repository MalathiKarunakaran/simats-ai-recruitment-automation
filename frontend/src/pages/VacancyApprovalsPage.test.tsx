import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import * as campusesApi from "@/api/campuses";
import type { UserRead, VacancyRequestRead } from "@/api/types";
import * as vacancyRequestsApi from "@/api/vacancyRequests";
import * as authContext from "@/auth/AuthContext";
import { VacancyApprovalsPage } from "@/pages/VacancyApprovalsPage";

vi.mock("@/api/vacancyRequests");
vi.mock("@/api/campuses");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListVacancyRequests = vi.mocked(vacancyRequestsApi.listVacancyRequests);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedDeanApprove = vi.mocked(vacancyRequestsApi.deanApproveVacancyRequest);
const mockedHrApprove = vi.mocked(vacancyRequestsApi.hrApproveVacancyRequest);
const mockedPublish = vi.mocked(vacancyRequestsApi.publishVacancyRequest);
const mockedReject = vi.mocked(vacancyRequestsApi.rejectVacancyRequest);

function makeVR(overrides: Partial<VacancyRequestRead>): VacancyRequestRead {
  return {
    id: "vr-1",
    campus_id: "c-sse",
    department_id: "d-1",
    role_category: "TEACHING",
    position_title: "Assistant Professor",
    employment_type: "FULL_TIME",
    requested_count: 2,
    qualification: "PhD",
    experience_required: "3+ years",
    salary_band_min: null,
    salary_band_max: null,
    jd_draft: null,
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
    created_at: "2026-07-19T00:00:00Z",
    updated_at: "2026-07-19T00:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <VacancyApprovalsPage />
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
  it("shows a scope message for a role outside the approval chain", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue([]);
    mockQueue({});

    renderPage();

    expect(await screen.findByText("Your role doesn't take part in the approval chain.")).toBeInTheDocument();
  });

  it("shows Dean-approve and Reject for a SUBMITTED request as Associate Dean", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "ASSOCIATE_DEAN_RECRUITMENT" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
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
  });

  it("shows HR-approve for DEAN_APPROVED and Publish for APPROVED as HR Admin", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
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

    mockedPublish.mockResolvedValue({
      id: "jp-1",
      approved_vacancy_id: "av-1",
      campus_id: "c-sse",
      public_apply_slug: "sse-lecturer-abcd",
      published_at: "2026-07-30T00:00:00Z",
      closed_at: null,
      is_active: true,
      created_at: "2026-07-30T00:00:00Z",
      updated_at: "2026-07-30T00:00:00Z",
    });
    await userEvent.click(within(lecturerRow).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(mockedPublish).toHaveBeenCalledWith("vr-3"));
  });

  it("sorts the queue by priority first, then by how long each request has been waiting", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
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
      login: vi.fn(),
      logout: vi.fn(),
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
  });

  it("shows an error message when an approval action fails", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "ASSOCIATE_DEAN_RECRUITMENT" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue([]);
    mockQueue({ SUBMITTED: [makeVR({})] });
    mockedDeanApprove.mockRejectedValue(new ApiError(409, "Cannot Dean-approve from status SUBMITTED"));

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Dean-approve" }));

    expect(await screen.findByText("Cannot Dean-approve from status SUBMITTED")).toBeInTheDocument();
  });
});
