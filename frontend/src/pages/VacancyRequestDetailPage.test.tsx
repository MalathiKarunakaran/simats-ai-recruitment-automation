import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { ApprovedVacancyRead, HiringSlotRead, UserRead, VacancyRequestRead } from "@/api/types";
import * as approvedVacanciesApi from "@/api/approvedVacancies";
import * as vacancyRequestsApi from "@/api/vacancyRequests";
import * as authContext from "@/auth/AuthContext";
import { VacancyRequestDetailPage } from "@/pages/VacancyRequestDetailPage";

vi.mock("@/api/vacancyRequests");
vi.mock("@/api/approvedVacancies");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedGetVacancyRequest = vi.mocked(vacancyRequestsApi.getVacancyRequest);
const mockedSubmit = vi.mocked(vacancyRequestsApi.submitVacancyRequest);
const mockedGenerateJd = vi.mocked(vacancyRequestsApi.generateJd);
const mockedCancel = vi.mocked(vacancyRequestsApi.cancelVacancyRequest);
const mockedDelete = vi.mocked(vacancyRequestsApi.deleteVacancyRequest);
const mockedUpdateSlotCount = vi.mocked(vacancyRequestsApi.updateSlotCount);
const mockedGetApprovedVacancyForRequest = vi.mocked(approvedVacanciesApi.getApprovedVacancyForRequest);
const mockedListHiringSlots = vi.mocked(approvedVacanciesApi.listHiringSlots);

function baseVr(overrides: Partial<VacancyRequestRead>): VacancyRequestRead {
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
    ...overrides,
  };
}

function baseApprovedVacancy(overrides: Partial<ApprovedVacancyRead>): ApprovedVacancyRead {
  return {
    id: "av-1",
    vacancy_request_id: "vr-1",
    campus_id: "c-sse",
    total_positions: 2,
    approved_by_id: "u-2",
    approved_at: "2026-01-02T00:00:00Z",
    closed_at: null,
    created_at: "2026-01-02T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

function slot(overrides: Partial<HiringSlotRead>): HiringSlotRead {
  return {
    id: "slot-1",
    approved_vacancy_id: "av-1",
    slot_number: 1,
    status: "OPEN",
    reserved_application_id: null,
    reserved_at: null,
    filled_at: null,
    released_at: null,
    created_at: "2026-01-02T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/vacancy-requests/vr-1"]}>
        <Routes>
          <Route path="/vacancy-requests/:id" element={<VacancyRequestDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("VacancyRequestDetailPage", () => {
  it("shows Submit/Edit/Delete for a DRAFT request to its owning HOD", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD", campus_id: "c-sse" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetVacancyRequest.mockResolvedValue(baseVr({ status: "DRAFT" }));

    renderDetail();

    await waitFor(() => expect(screen.getByText("Submit")).toBeInTheDocument());
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.queryByText("Dean-approve")).not.toBeInTheDocument();
  });

  it("shows Dean-approve/Reject for a SUBMITTED request to a Dean, and neither to an unrelated role", async () => {
    mockedGetVacancyRequest.mockResolvedValue(baseVr({ status: "SUBMITTED" }));

    mockedUseAuth.mockReturnValue({
      user: { role: "ASSOCIATE_DEAN_RECRUITMENT" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    const { unmount } = renderDetail();
    await waitFor(() => expect(screen.getByText("Dean-approve")).toBeInTheDocument());
    expect(screen.getByText("Reject")).toBeInTheDocument();
    unmount();

    mockedUseAuth.mockReturnValue({
      user: { role: "RECRUITMENT_OFFICER" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    renderDetail();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.queryByText("Dean-approve")).not.toBeInTheDocument();
    expect(screen.queryByText("Reject")).not.toBeInTheDocument();
  });

  it("clicking Submit calls the mutation and the status updates", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD", campus_id: "c-sse" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetVacancyRequest.mockResolvedValueOnce(baseVr({ status: "DRAFT" }));
    mockedSubmit.mockResolvedValue(baseVr({ status: "SUBMITTED" }));
    mockedGetVacancyRequest.mockResolvedValueOnce(baseVr({ status: "SUBMITTED" }));

    renderDetail();
    await waitFor(() => expect(screen.getByText("Submit")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Submit"));

    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledWith("vr-1"));
    await waitFor(() => expect(screen.getByText("SUBMITTED")).toBeInTheDocument());
  });

  it("shows Generate JD for a DRAFT request's owning HOD, submits instructions, and renders the result", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD", campus_id: "c-sse" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetVacancyRequest.mockResolvedValueOnce(baseVr({ status: "DRAFT", jd_draft: null }));
    mockedGenerateJd.mockResolvedValue(baseVr({ status: "DRAFT", jd_draft: "## Role Overview\nGenerated JD text." }));
    mockedGetVacancyRequest.mockResolvedValueOnce(
      baseVr({ status: "DRAFT", jd_draft: "## Role Overview\nGenerated JD text." }),
    );

    renderDetail();
    await waitFor(() => expect(screen.getByText("Generate JD")).toBeInTheDocument());
    expect(screen.getByText("No job description generated yet.")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Generate JD"));
    await userEvent.type(screen.getByLabelText(/Additional instructions/), "Emphasize research experience.");
    await userEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() =>
      expect(mockedGenerateJd).toHaveBeenCalledWith("vr-1", {
        additional_instructions: "Emphasize research experience.",
      }),
    );
    expect(await screen.findByText(/Generated JD text/)).toBeInTheDocument();
  });

  it("does not show Generate JD for a Recruitment Officer", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "RECRUITMENT_OFFICER" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetVacancyRequest.mockResolvedValue(baseVr({ status: "DRAFT" }));

    renderDetail();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.queryByText("Generate JD")).not.toBeInTheDocument();
  });

  it("shows Cancel for HR_ADMIN on a PUBLISHED request, but not for an unrelated role", async () => {
    mockedGetVacancyRequest.mockResolvedValue(baseVr({ status: "PUBLISHED" }));
    mockedGetApprovedVacancyForRequest.mockResolvedValue(baseApprovedVacancy({}));
    mockedListHiringSlots.mockResolvedValue([slot({ id: "s1" }), slot({ id: "s2", status: "FILLED" })]);

    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    const { unmount } = renderDetail();
    await waitFor(() => expect(screen.getByText("Cancel")).toBeInTheDocument());
    unmount();

    mockedUseAuth.mockReturnValue({
      user: { role: "INTERVIEW_PANEL_MEMBER" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    renderDetail();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
  });

  it("cancelling a request requires a reason and calls the mutation with it", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetVacancyRequest.mockResolvedValueOnce(baseVr({ status: "PUBLISHED" }));
    mockedGetApprovedVacancyForRequest.mockResolvedValue(baseApprovedVacancy({}));
    mockedListHiringSlots.mockResolvedValue([slot({})]);
    mockedCancel.mockResolvedValue(
      baseVr({ status: "CANCELLED", cancellation_reason: "No longer needed", cancelled_by_id: "u-9" }),
    );
    mockedGetVacancyRequest.mockResolvedValueOnce(baseVr({ status: "CANCELLED", cancellation_reason: "No longer needed" }));

    renderDetail();
    await waitFor(() => expect(screen.getByText("Cancel")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Cancel"));
    const confirmButton = screen.getByRole("button", { name: "Confirm cancel" });
    expect(confirmButton).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Reason"), "No longer needed");
    expect(confirmButton).not.toBeDisabled();

    await userEvent.click(confirmButton);

    await waitFor(() => expect(mockedCancel).toHaveBeenCalledWith("vr-1", "No longer needed"));
    await waitFor(() => expect(screen.getByText("CANCELLED")).toBeInTheDocument());
  });

  it("shows the Positions card and Adjust count dialog for an APPROVED request, submitting the new count", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetVacancyRequest.mockResolvedValue(baseVr({ status: "APPROVED", requested_count: 5 }));
    mockedGetApprovedVacancyForRequest.mockResolvedValue(baseApprovedVacancy({ total_positions: 2 }));
    mockedListHiringSlots.mockResolvedValue([
      slot({ id: "s1", status: "OPEN" }),
      slot({ id: "s2", status: "FILLED" }),
    ]);
    mockedUpdateSlotCount.mockResolvedValue(baseApprovedVacancy({ total_positions: 3 }));

    renderDetail();
    await waitFor(() => expect(screen.getByText("Positions")).toBeInTheDocument());
    expect(screen.getByText("2")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Adjust count"));
    const countInput = screen.getByLabelText("Requested count") as HTMLInputElement;
    expect(countInput.value).toBe("2");

    await userEvent.clear(countInput);
    await userEvent.type(countInput, "3");
    await userEvent.click(screen.getByRole("button", { name: "Update count" }));

    await waitFor(() => expect(mockedUpdateSlotCount).toHaveBeenCalledWith("vr-1", 3));
  });

  it("shows the Over-sanction badge when is_over_sanction is true", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetVacancyRequest.mockResolvedValue(
      baseVr({ status: "SUBMITTED", is_over_sanction: true, over_sanction_justification: "Urgent backfill" }),
    );

    renderDetail();

    expect(await screen.findByText("Over-sanction")).toBeInTheDocument();
    expect(screen.getByText("Urgent backfill")).toBeInTheDocument();
  });

  it("only offers the SUPER_ADMIN-only 'Override sanction limit' checkbox to a SUPER_ADMIN, requiring a justification before submitting with it", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN", campus_id: "c-sse" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetVacancyRequest.mockResolvedValueOnce(baseVr({ status: "DRAFT", designation_id: "desg-1" }));
    mockedSubmit.mockResolvedValue(baseVr({ status: "SUBMITTED", is_over_sanction: true }));
    mockedGetVacancyRequest.mockResolvedValueOnce(baseVr({ status: "SUBMITTED", is_over_sanction: true }));

    renderDetail();
    await waitFor(() => expect(screen.getByText("Override sanction limit")).toBeInTheDocument());

    const submitButton = screen.getByRole("button", { name: "Submit" });
    await userEvent.click(screen.getByLabelText("Override sanction limit"));
    expect(submitButton).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Justification"), "Approved by management");
    expect(submitButton).toBeEnabled();

    await userEvent.click(submitButton);

    await waitFor(() =>
      expect(mockedSubmit).toHaveBeenCalledWith("vr-1", {
        override_sanction: true,
        override_justification: "Approved by management",
      }),
    );
  });

  it("does not show the override checkbox to a non-SUPER_ADMIN", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD", campus_id: "c-sse" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetVacancyRequest.mockResolvedValue(baseVr({ status: "DRAFT" }));

    renderDetail();
    await waitFor(() => expect(screen.getByText("Submit")).toBeInTheDocument());
    expect(screen.queryByText("Override sanction limit")).not.toBeInTheDocument();
  });

  it("deleting a DRAFT request requires confirming a dialog before the mutation fires", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD", campus_id: "c-sse" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetVacancyRequest.mockResolvedValue(baseVr({ status: "DRAFT" }));
    mockedDelete.mockResolvedValue(undefined);

    renderDetail();
    await waitFor(() => expect(screen.getByText("Delete")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(mockedDelete).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    expect(screen.getByText("Delete this draft vacancy request? This cannot be undone.")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith("vr-1"));
  });

  it("Cancel in the delete confirm dialog aborts without calling the mutation", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD", campus_id: "c-sse" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetVacancyRequest.mockResolvedValue(baseVr({ status: "DRAFT" }));
    mockedDelete.mockResolvedValue(undefined);
    mockedDelete.mockClear(); // a prior test in this file already confirmed a delete

    renderDetail();
    await waitFor(() => expect(screen.getByText("Delete")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");

    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it("does not show Cancel or Adjust count for a Recruitment Officer", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "RECRUITMENT_OFFICER" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetVacancyRequest.mockResolvedValue(baseVr({ status: "APPROVED" }));
    mockedGetApprovedVacancyForRequest.mockResolvedValue(baseApprovedVacancy({}));
    mockedListHiringSlots.mockResolvedValue([slot({})]);

    renderDetail();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
    expect(screen.queryByText("Adjust count")).not.toBeInTheDocument();
  });
});
