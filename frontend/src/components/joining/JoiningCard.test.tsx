import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import * as employeesApi from "@/api/employees";
import * as joiningApi from "@/api/joining";
import type { ApplicationRead, EmployeeRead, JoiningDocumentRead, JoiningRecordRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { JoiningCard } from "@/components/joining/JoiningCard";

vi.mock("@/api/joining");
vi.mock("@/api/employees");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedGetJoiningRecord = vi.mocked(joiningApi.getJoiningRecord);
const mockedListJoiningDocuments = vi.mocked(joiningApi.listJoiningDocuments);
const mockedListEmployees = vi.mocked(employeesApi.listEmployees);

function makeApplication(overrides: Partial<ApplicationRead> = {}): ApplicationRead {
  return {
    id: "app-1",
    candidate_id: "cand-1",
    job_posting_id: "jp-1",
    campus_id: "c-sse",
    status: "JOINING_PENDING",
    applied_at: "2026-01-02T00:00:00Z",
    recorded_by_id: "u-1",
    rejection_reason: null,
    rejected_at: null,
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
  it("renders nothing for a role outside the read roles", () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });

    const { container } = renderCard(makeApplication());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows Mark joined for Recruitment Officer but not the document toggle", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "RECRUITMENT_OFFICER" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument()]);

    renderCard(makeApplication({ status: "JOINING_PENDING" }));

    await waitFor(() => expect(screen.getByText("Mark joined")).toBeInTheDocument());
    expect(screen.queryByText("Mark received")).not.toBeInTheDocument();
  });

  it("shows the document toggle for HR Admin", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument()]);

    renderCard(makeApplication({ status: "JOINING_PENDING" }));

    await waitFor(() => expect(screen.getByText("Mark received")).toBeInTheDocument());
  });

  it("disables Complete onboarding while a document is still pending", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument({ status: "PENDING" })]);

    renderCard(makeApplication({ status: "JOINED" }));

    await waitFor(() => expect(screen.getByText("Complete onboarding")).toBeInTheDocument());
    expect(screen.getByText("Complete onboarding")).toBeDisabled();
    expect(screen.getByText("All documents must be received first.")).toBeInTheDocument();
  });

  it("enables Complete onboarding once all documents are received", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument({ status: "RECEIVED" })]);

    renderCard(makeApplication({ status: "JOINED" }));

    await waitFor(() => expect(screen.getByText("Complete onboarding")).not.toBeDisabled());
  });

  it("shows employee fields inline once EMPLOYEE_CREATED", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument({ status: "RECEIVED" })]);
    mockedListEmployees.mockResolvedValue([
      {
        id: "emp-1",
        application_id: "app-1",
        employee_code: "SSE-0001",
        campus_id: "c-sse",
        department_id: null,
        full_name: "Jane Doe",
        email: "jane@example.com",
        phone_number: null,
        designation: "Assistant Professor",
        date_of_joining: "2026-03-01",
        user_id: null,
        created_at: "2026-01-02T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      } satisfies EmployeeRead,
    ]);

    renderCard(makeApplication({ status: "EMPLOYEE_CREATED" }));

    await waitFor(() => expect(screen.getByText("SSE-0001")).toBeInTheDocument());
  });
});
