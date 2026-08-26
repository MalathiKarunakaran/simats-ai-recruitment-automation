import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as departmentsApi from "@/api/departments";
import * as employeesApi from "@/api/employees";
import * as joiningApi from "@/api/joining";
import type {
  ApplicationRead,
  DepartmentRead,
  EmployeeRead,
  JoiningDocumentRead,
  JoiningRecordRead,
  UserRead,
} from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { JoiningCard } from "@/components/joining/JoiningCard";

vi.mock("@/api/joining");
vi.mock("@/api/employees");
vi.mock("@/api/departments");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedGetJoiningRecord = vi.mocked(joiningApi.getJoiningRecord);
const mockedListJoiningDocuments = vi.mocked(joiningApi.listJoiningDocuments);
const mockedListEmployees = vi.mocked(employeesApi.listEmployees);
const mockedListDepartments = vi.mocked(departmentsApi.listDepartments);

function makeApplication(overrides: Partial<ApplicationRead> = {}): ApplicationRead {
  return {
    id: "app-1",
    candidate_id: "cand-1",
    job_posting_id: "jp-1",
    campus_id: "c-sse",
    role_category: "TEACHING",
    status: "JOINING_CONFIRMED",
    applied_at: "2026-01-02T00:00:00Z",
    recorded_by_id: "u-1",
    rejection_reason: null,
    rejected_at: null,
    withdrawn_reason: null,
    withdrawn_at: null,
    panel_members: null,
    panel_result: null,
    panel_remarks: null,
    salary_fixed: null,
    called_date: null,
    interview_scheduled_date: null,
    offer_given_date: null,
    expected_joining_date: null,
    actual_joining_date: null,
    department_allotted_id: null,
    room_allotted: null,
    orientation_date: null,
    hod_assigned: null,
    qualification_mismatch: false,
    qualification_mismatch_reason: null,
    created_at: "2026-01-02T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

const RECORD: JoiningRecordRead = {
  id: "jr-1",
  application_id: "app-1",
  joining_date: "2026-03-01",
  actual_joining_date: null,
  onboarding_completed_at: null,
  onboarding_completed_by_id: null,
  created_at: "2026-01-02T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

const DEPARTMENT: DepartmentRead = {
  id: "dept-1",
  campus_id: "c-sse",
  name: "Computer Science",
  code: null,
  category: null,
  parent_group: null,
  description: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function makeDocument(overrides: Partial<JoiningDocumentRead> = {}): JoiningDocumentRead {
  return {
    id: "doc-1",
    application_id: "app-1",
    document_type: "PAN",
    status: "PENDING",
    storage_key: null,
    received_at: null,
    notes: null,
    created_at: "2026-01-02T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

function renderCard(application: ApplicationRead) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <JoiningCard application={application} />
    </QueryClientProvider>,
  );
}

describe("JoiningCard", () => {
  beforeEach(() => {
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
  });

  it("renders nothing for a role outside the read roles", () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });

    const { container } = renderCard(makeApplication());
    expect(container).toBeEmptyDOMElement();
  });

  // RBAC permission-gate audit (2026-08-24): every joining.py endpoint
  // (reads and writes alike) is gated by require_permission(ONBOARDING),
  // not READ_ROLES/HR_ONLY_ROLES alone -- these two lock in the fix without
  // changing the test above (no grant passed there, so it behaves exactly
  // as before).
  it("shows the card to a role outside READ_ROLES individually granted ONBOARDING", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
      hasPermission: (permission) => permission === "ONBOARDING",
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument()]);

    renderCard(makeApplication({ status: "JOINING_CONFIRMED" }));

    await waitFor(() => expect(screen.getByText("Mark joined")).toBeInTheDocument());
    // canWrite is also unlocked by the same ONBOARDING grant -- the document
    // toggle (an HR_ONLY_ROLES-gated write action) is visible too.
    await waitFor(() => expect(screen.getByText("Mark received")).toBeInTheDocument());
  });

  it("shows Mark joined for Recruitment Officer but not the document toggle", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "RECRUITMENT_OFFICER" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument()]);

    renderCard(makeApplication({ status: "JOINING_CONFIRMED" }));

    await waitFor(() => expect(screen.getByText("Mark joined")).toBeInTheDocument());
    expect(screen.queryByText("Mark received")).not.toBeInTheDocument();
  });

  it("shows the document toggle for HR Admin", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument()]);

    renderCard(makeApplication({ status: "JOINING_CONFIRMED" }));

    await waitFor(() => expect(screen.getByText("Mark received")).toBeInTheDocument());
  });

  it("disables the department/room allotment confirm button while a document is still pending", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument({ status: "PENDING" })]);

    renderCard(makeApplication({ status: "JOINED" }));

    await waitFor(() =>
      expect(screen.getByText("Confirm department & room allotment")).toBeInTheDocument(),
    );
    expect(screen.getByText("Confirm department & room allotment")).toBeDisabled();
    expect(screen.getByText("All documents must be received first.")).toBeInTheDocument();
  });

  it("enables the department/room allotment confirm button once all documents are received and a department is picked", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument({ status: "RECEIVED" })]);

    renderCard(makeApplication({ status: "JOINED" }));

    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
    // No department selected yet -- still disabled even with docs received.
    expect(screen.getByText("Confirm department & room allotment")).toBeDisabled();
  });

  it("shows the orientation date input at DEPARTMENT_ROOM_ALLOTTED", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument({ status: "RECEIVED" })]);

    renderCard(makeApplication({ status: "DEPARTMENT_ROOM_ALLOTTED" }));

    await waitFor(() => expect(screen.getByText("Mark orientation complete")).toBeInTheDocument());
  });

  it("requires HOD assigned before enabling Hand over to HOD at ORIENTATION_COMPLETE", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument({ status: "RECEIVED" })]);

    renderCard(makeApplication({ status: "ORIENTATION_COMPLETE" }));

    await waitFor(() => expect(screen.getByText("Hand over to HOD")).toBeInTheDocument());
    expect(screen.getByText("Hand over to HOD")).toBeDisabled();
  });

  it("shows employee fields inline once HANDED_OVER_TO_HOD", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument({ status: "RECEIVED" })]);
    mockedListEmployees.mockResolvedValue([
      {
        id: "emp-1",
        application_id: "app-1",
        employee_code: "SSE-0001",
        campus_id: "c-sse",
        department_id: "dept-1",
        full_name: "Jane Doe",
        email: "jane@example.com",
        phone_number: null,
        designation: "Assistant Professor",
        date_of_joining: "2026-03-01",
        user_id: null,
        employment_status: "ACTIVE",
        separation_date: null,
        separation_reason: null,
        separated_by_id: null,
        created_at: "2026-01-02T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      } satisfies EmployeeRead,
    ]);

    renderCard(
      makeApplication({
        status: "HANDED_OVER_TO_HOD",
        room_allotted: "R-305",
        hod_assigned: "Dr. Test HOD",
      }),
    );

    await waitFor(() => expect(screen.getByText("SSE-0001")).toBeInTheDocument());
    expect(screen.getByText("R-305")).toBeInTheDocument();
    expect(screen.getByText("Dr. Test HOD")).toBeInTheDocument();
  });
});
