import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import * as sheetSyncApi from "@/api/sheetSync";
import type { SheetSyncRun, SheetSyncStatusItem, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { SheetSyncPage } from "@/pages/SheetSyncPage";

vi.mock("@/api/sheetSync");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedList = vi.mocked(sheetSyncApi.listSheetSyncRuns);

function mockUser(role: UserRead["role"]) {
  mockedUseAuth.mockReturnValue({
    user: { role } as UserRead,
    isLoading: false,
    login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
    logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    hasPermission: () => false,
  });
}

function run(source: string, over: Partial<SheetSyncRun> = {}): SheetSyncRun {
  return {
    id: "r-1",
    source,
    dry_run: false,
    created_at: new Date().toISOString(),
    counts: { received: 120, inserted: 5, updated: 3, unchanged: 110, deactivated: 2, flagged: 4, not_in_employees: 7 },
    missing_headers: [],
    ...over,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SheetSyncPage />
    </QueryClientProvider>,
  );
}

describe("SheetSyncPage", () => {
  it("shows a not-allowed message to non-Super Admins", () => {
    mockUser("HR_ADMIN");
    renderPage();
    expect(screen.getByText(/not allowed/i)).toBeInTheDocument();
    expect(mockedList).not.toHaveBeenCalled();
  });

  it("renders five cards, counts, warnings, and the flagged download rules", async () => {
    mockUser("SUPER_ADMIN");
    const items: SheetSyncStatusItem[] = [
      { source: "TALENT_POOL_TEACHING_FINAL", last_run: run("TALENT_POOL_TEACHING_FINAL", { id: null }), last_dry_run: null },
      { source: "NEW_JOINEES", last_run: run("NEW_JOINEES", { missing_headers: ["Dept New"] }), last_dry_run: run("NEW_JOINEES", { id: "r-2", dry_run: true }) },
      { source: "PRO_APP_ORDER", last_run: run("PRO_APP_ORDER", { counts: { received: 10, flagged: 0 } }), last_dry_run: null },
    ];
    mockedList.mockResolvedValue(items);
    renderPage();

    await waitFor(() => expect(screen.getByText("New Joinees")).toBeInTheDocument());
    expect(screen.getByText("Final (Teaching applicants)")).toBeInTheDocument();
    expect(screen.getByText("NTS (Non-teaching applicants)")).toBeInTheDocument();
    expect(screen.getByText("Pro App Order")).toBeInTheDocument();
    expect(screen.getByText("New Depts Updated")).toBeInTheDocument();
    expect(screen.getByText(/Waiting for mapping approval/)).toBeInTheDocument();
    expect(screen.getByText("Not synced yet")).toBeInTheDocument(); // NTS
    expect(screen.getAllByText("Not in Employees").length).toBeGreaterThan(0);
    expect(screen.getByText(/Missing headers in the sheet: Dept New/)).toBeInTheDocument();
    expect(screen.getByText(/Last dry run/)).toBeInTheDocument();
    // Only New Joinees has both an id and flagged > 0.
    expect(screen.getAllByRole("button", { name: /Download flagged rows/ })).toHaveLength(1);
  });
});
