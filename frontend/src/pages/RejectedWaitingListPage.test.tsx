import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as outcomesApi from "@/api/applicationOutcomes";
import * as applicationsApi from "@/api/applications";
import * as campusesApi from "@/api/campuses";
import type { ApplicationOutcomePage, ApplicationOutcomeRow, ApplicationRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { RejectedWaitingListPage } from "@/pages/RejectedWaitingListPage";

vi.mock("@/api/applicationOutcomes");
vi.mock("@/api/applications");
vi.mock("@/api/campuses");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedWaitingList = vi.mocked(outcomesApi.listWaitingList);
const mockedRejected = vi.mocked(outcomesApi.listRejected);
const mockedExportRejected = vi.mocked(outcomesApi.exportRejected);
const mockedTransition = vi.mocked(applicationsApi.transitionApplicationStatus);

function row(overrides: Partial<ApplicationOutcomeRow>): ApplicationOutcomeRow {
  return {
    application_id: "app-1",
    candidate_id: "cand-1",
    candidate_name: "Asha R",
    candidate_email: "asha@example.com",
    candidate_phone: null,
    job_posting_id: "jp-1",
    posting_number: "JP-2026-000001",
    position_title: "Assistant Professor",
    department_name: "CSE",
    campus_code: "SSE",
    role_category: "TEACHING",
    status: "WAITLISTED",
    waitlist_rank: 1,
    rejection_category: null,
    rejected_at_stage: null,
    rejection_remarks: null,
    rejected_at: null,
    updated_at: "2026-10-29T00:00:00Z",
    interview_date: "2026-10-24",
    panel_remarks: "Strong research record",
    vacancy_total_positions: 1,
    vacancy_open_slots: 1,
    vacancy_slot_holders: [],
    ...overrides,
  };
}

function page(items: ApplicationOutcomeRow[]): ApplicationOutcomePage {
  return {
    items,
    total: items.length,
    limit: 50,
    offset: 0,
    category_counts: { TEACHING: items.length, NON_TEACHING: 0, HOUSEKEEPING: 0, ALL: items.length },
  };
}

function asRole(role: string) {
  mockedUseAuth.mockReturnValue({
    user: { role } as UserRead,
    isLoading: false,
    login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
    logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RejectedWaitingListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RejectedWaitingListPage", () => {
  beforeEach(() => {
    vi.mocked(campusesApi.listCampuses).mockResolvedValue([]);
    mockedWaitingList.mockResolvedValue(
      page([row({}), row({ application_id: "app-2", candidate_name: "Bala K", waitlist_rank: 2 })]),
    );
    mockedRejected.mockResolvedValue(
      page([
        row({
          application_id: "app-3",
          candidate_name: "Chitra M",
          status: "REJECTED",
          waitlist_rank: null,
          rejection_category: "PANEL_NOT_RECOMMENDED",
          rejected_at_stage: "INTERVIEWED",
          rejection_remarks: "Weak demo",
          rejected_at: "2026-10-20T00:00:00Z",
        }),
        row({ application_id: "app-4", candidate_name: "Deepa S", status: "REJECTED", waitlist_rank: null }),
      ]),
    );
  });

  it("groups the waiting list by vacancy, in rank order, with the category counts", async () => {
    asRole("HR_ADMIN");
    renderPage();

    expect(await screen.findByText("Asha R")).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("1");
    expect(rows[0]).toHaveTextContent("Asha R");
    expect(rows[1]).toHaveTextContent("Bala K");
    expect(screen.getByRole("tab", { name: "Teaching (2)" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Assistant Professor waiting list" })).toBeInTheDocument();
    expect(screen.getByText("1 post open — ready to promote")).toBeInTheDocument();
    expect(screen.getAllByText("Strong research record")).toHaveLength(2);
  });

  it("says who holds the post and disables Promote when none is free", async () => {
    asRole("HR_ADMIN");
    mockedWaitingList.mockResolvedValue(
      page([row({ vacancy_open_slots: 0, vacancy_slot_holders: ["Priya Raman"] })]),
    );
    renderPage();

    expect(
      await screen.findByText("All posts held by Priya Raman — promotion opens if one is rejected or withdraws"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Promote" })).toBeDisabled();
  });

  it("promotes from the waiting list with a reason", async () => {
    asRole("RECRUITMENT_COORDINATOR");
    mockedTransition.mockResolvedValue({ status: "SELECTED" } as ApplicationRead);
    renderPage();

    await screen.findByText("Asha R");
    await userEvent.click(screen.getAllByRole("button", { name: "Promote to Selected" })[0]);
    await userEvent.type(screen.getByLabelText("Reason"), "First choice declined");
    await userEvent.click(screen.getByText("Confirm promotion"));

    await waitFor(() =>
      expect(mockedTransition).toHaveBeenCalledWith("app-1", { status: "SELECTED", reason: "First choice declined" }),
    );
  });

  it("hides Promote from a read-only role", async () => {
    asRole("MANAGEMENT");
    renderPage();
    await screen.findByText("Asha R");
    expect(screen.queryByRole("button", { name: /Promote/ })).not.toBeInTheDocument();
  });

  it("shows rejections with reason, stage and remarks, and exports with the active filters", async () => {
    asRole("HR_ADMIN");
    mockedExportRejected.mockResolvedValue();
    renderPage();
    await screen.findByText("Asha R");

    await userEvent.click(screen.getByRole("tab", { name: "Rejected" }));
    expect(await screen.findByText("Chitra M")).toBeInTheDocument();
    expect(screen.getByText("Panel not recommended")).toBeInTheDocument();
    expect(screen.getByText("INTERVIEWED")).toBeInTheDocument();
    expect(screen.getByText("Weak demo")).toBeInTheDocument();
    // A rejection made without a reason from the list.
    expect(screen.getByText("Not recorded")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Reason filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Not eligible" }));
    await waitFor(() =>
      expect(mockedRejected).toHaveBeenLastCalledWith(
        expect.objectContaining({ rejectionCategory: "NOT_ELIGIBLE", offset: 0 }),
      ),
    );

    await userEvent.click(screen.getByRole("button", { name: /Export to Excel/ }));
    expect(mockedExportRejected).toHaveBeenCalledWith(expect.objectContaining({ rejectionCategory: "NOT_ELIGIBLE" }));
  });
});
