import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import * as eligibilityRulesApi from "@/api/eligibilityRules";
import type { CampusRead, EligibilityRule, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { EligibilityRulesPage } from "@/pages/EligibilityRulesPage";

vi.mock("@/api/eligibilityRules");
vi.mock("@/api/campuses");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListEligibilityRules = vi.mocked(eligibilityRulesApi.listEligibilityRules);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedCreateEligibilityRule = vi.mocked(eligibilityRulesApi.createEligibilityRule);

function mockUser(role: UserRead["role"] | null) {
  mockedUseAuth.mockReturnValue({
    user: role ? ({ role } as UserRead) : null,
    isLoading: false,
    login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
    logout: vi.fn(),
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

const RULE: EligibilityRule = {
  id: "rule-1",
  campus_id: "c-sse",
  staff_category: "TEACHING",
  position_title: null,
  required_qualification_keyword: "PHD",
  is_active: true,
  notes: "Spec example rule",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <EligibilityRulesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("EligibilityRulesPage", () => {
  it("blocks a CANDIDATE-role account from viewing the page", async () => {
    mockUser("CANDIDATE");
    mockedListEligibilityRules.mockResolvedValue([RULE]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Only staff can view eligibility rules.")).toBeInTheDocument(),
    );
  });

  it("lets a non-admin staff role view rules read-only, with no write controls", async () => {
    mockUser("CAMPUS_HOD");
    mockedListEligibilityRules.mockResolvedValue([RULE]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByText("SSE")).toBeInTheDocument());
    expect(screen.getByText("PHD")).toBeInTheDocument();
    expect(screen.queryByText("New rule")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    // The Active badge is still visible (in the "Active" column header and the row's badge),
    // but not as a clickable toggle button.
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Active" })).not.toBeInTheDocument();
  });

  it("renders eligibility rules with resolved campus code for HR Admin", async () => {
    mockUser("HR_ADMIN");
    mockedListEligibilityRules.mockResolvedValue([RULE]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByText("SSE")).toBeInTheDocument());
    expect(screen.getByText("TEACHING")).toBeInTheDocument();
    expect(screen.getByText("All positions")).toBeInTheDocument();
    expect(screen.getByText("PHD")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Active" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New rule" })).toBeInTheDocument();
  });

  it("shows the empty-state message when no rules exist", async () => {
    mockUser("SUPER_ADMIN");
    mockedListEligibilityRules.mockResolvedValue([]);
    mockedListCampuses.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText("No eligibility rules found.")).toBeInTheDocument());
  });

  it("submits a new rule with the entered fields", async () => {
    mockUser("SUPER_ADMIN");
    mockedListEligibilityRules.mockResolvedValue([]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedCreateEligibilityRule.mockResolvedValue(RULE);

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "New rule" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New rule" }));

    const [campusTrigger] = await screen.findAllByRole("combobox");
    await userEvent.click(campusTrigger);
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));

    await userEvent.type(screen.getByLabelText("Required qualification keyword"), "PHD");
    await userEvent.click(screen.getByRole("button", { name: "Create rule" }));

    await waitFor(() =>
      expect(mockedCreateEligibilityRule).toHaveBeenCalledWith({
        campus_id: "c-sse",
        staff_category: "TEACHING",
        position_title: null,
        required_qualification_keyword: "PHD",
        is_active: true,
        notes: null,
      }),
    );
  });
});
