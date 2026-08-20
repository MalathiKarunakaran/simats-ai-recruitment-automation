import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as auditLogsApi from "@/api/auditLogs";
import * as campusesApi from "@/api/campuses";
import type { AuditLogRead, CampusRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { ActivityLogPage } from "@/pages/ActivityLogPage";

vi.mock("@/api/auditLogs");
vi.mock("@/api/campuses");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListAuditLogs = vi.mocked(auditLogsApi.listAuditLogs);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);

function mockUser(role: UserRead["role"]) {
  mockedUseAuth.mockReturnValue({
    user: { role } as UserRead,
    isLoading: false,
    login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
    logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
  });
}

const CAMPUS: CampusRead = {
  id: "c-sse",
  code: "SSE",
  name: "Saveetha School of Engineering",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const ENTRY: AuditLogRead = {
  id: "log-1",
  actor_user_id: "u-1",
  actor_role_snapshot: "HR_ADMIN",
  campus_context_id: "c-sse",
  action: "VacancyRequest.created",
  entity_type: "VacancyRequest",
  entity_id: "vr-12345678-abcd",
  before_state: null,
  after_state: null,
  http_method: "POST",
  http_path: "/api/v1/vacancy-requests",
  status_code: 201,
  ip_address: null,
  user_agent: null,
  created_at: "2026-01-01T10:00:00Z",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ActivityLogPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ActivityLogPage", () => {
  it("blocks a role outside the backend's own read-role gate", () => {
    mockUser("RECRUITMENT_OFFICER");

    renderPage();

    expect(
      screen.getByText(
        "Only Super Admin, HR Admin, Associate Dean (Recruitment), or a Campus HOD can view the activity log.",
      ),
    ).toBeInTheDocument();
  });

  it("renders activity entries for a global-scope role", async () => {
    mockUser("SUPER_ADMIN");
    mockedListAuditLogs.mockResolvedValue([ENTRY]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByText("VacancyRequest.created")).toBeInTheDocument());
    expect(screen.getByText("HR ADMIN")).toBeInTheDocument();
  });

  it("shows a campus filter for a global-scope role and re-fetches when it changes", async () => {
    mockUser("HR_ADMIN");
    mockedListAuditLogs.mockResolvedValue([ENTRY]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();
    await waitFor(() =>
      expect(mockedListAuditLogs).toHaveBeenCalledWith({
        entityType: null,
        campusId: null,
        startDate: null,
        endDate: null,
      }),
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));

    await waitFor(() =>
      expect(mockedListAuditLogs).toHaveBeenCalledWith({
        entityType: null,
        campusId: "c-sse",
        startDate: null,
        endDate: null,
      }),
    );
  });

  it("hides the campus filter for a Campus HOD, who is hard-pinned server-side", async () => {
    mockUser("CAMPUS_HOD");
    mockedListAuditLogs.mockResolvedValue([ENTRY]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByText("VacancyRequest.created")).toBeInTheDocument());
    expect(screen.queryByRole("combobox", { name: "Campus filter" })).not.toBeInTheDocument();
  });

  it("re-fetches with the entity type filter", async () => {
    mockUser("SUPER_ADMIN");
    mockedListAuditLogs.mockResolvedValue([ENTRY]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();
    await waitFor(() =>
      expect(mockedListAuditLogs).toHaveBeenCalledWith({
        entityType: null,
        campusId: null,
        startDate: null,
        endDate: null,
      }),
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Entity type filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Offer" }));

    await waitFor(() =>
      expect(mockedListAuditLogs).toHaveBeenCalledWith({
        entityType: "Offer",
        campusId: null,
        startDate: null,
        endDate: null,
      }),
    );
  });

  it("re-fetches with a date range when the date control is used", async () => {
    mockUser("SUPER_ADMIN");
    mockedListAuditLogs.mockResolvedValue([ENTRY]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();
    await waitFor(() =>
      expect(mockedListAuditLogs).toHaveBeenCalledWith({
        entityType: null,
        campusId: null,
        startDate: null,
        endDate: null,
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: /All time/ }));
    await userEvent.click(await screen.findByRole("button", { name: "This week" }));

    await waitFor(() =>
      expect(mockedListAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ startDate: expect.any(String), endDate: expect.any(String) }),
      ),
    );
  });

  it("shows the empty-state message when no entries exist in scope", async () => {
    mockUser("SUPER_ADMIN");
    mockedListAuditLogs.mockResolvedValue([]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText("No activity recorded in this scope yet.")).toBeInTheDocument());
  });
});
