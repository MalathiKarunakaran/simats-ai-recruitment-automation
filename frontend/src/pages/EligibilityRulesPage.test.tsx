import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import { ApiError } from "@/api/client";
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
const mockedDeleteEligibilityRule = vi.mocked(eligibilityRulesApi.deleteEligibilityRule);

function mockUser(role: UserRead["role"] | null) {
  mockedUseAuth.mockReturnValue({
    user: role ? ({ role } as UserRead) : null,
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

  it("hides inactive rules by default, reachable via the Active filter", async () => {
    mockUser("HR_ADMIN");
    const inactiveRule: EligibilityRule = {
      ...RULE,
      id: "rule-2",
      is_active: false,
      required_qualification_keyword: "MASTERS",
    };
    mockedListEligibilityRules.mockResolvedValue([RULE, inactiveRule]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();
    await waitFor(() => expect(screen.getByText("PHD")).toBeInTheDocument());
    expect(screen.queryByText("MASTERS")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Active filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Inactive" }));

    expect(await screen.findByText("MASTERS")).toBeInTheDocument();
    expect(screen.queryByText("PHD")).not.toBeInTheDocument();
  });

  it("narrows by campus and by staff category", async () => {
    mockUser("HR_ADMIN");
    const otherCampus: CampusRead = { ...CAMPUS, id: "c-sclas", code: "SCLAS", name: "SCLAS" };
    const nonTeachingRule: EligibilityRule = {
      ...RULE,
      id: "rule-2",
      campus_id: "c-sclas",
      staff_category: "NON_TEACHING",
      required_qualification_keyword: "MASTERS",
    };
    mockedListEligibilityRules.mockResolvedValue([RULE, nonTeachingRule]);
    mockedListCampuses.mockResolvedValue([CAMPUS, otherCampus]);

    renderPage();
    await waitFor(() => expect(screen.getByText("PHD")).toBeInTheDocument());
    expect(screen.getByText("MASTERS")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SCLAS" }));
    expect(screen.queryByText("PHD")).not.toBeInTheDocument();
    expect(screen.getByText("MASTERS")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "All campuses" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Category filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "TEACHING" }));
    expect(screen.getByText("PHD")).toBeInTheDocument();
    expect(screen.queryByText("MASTERS")).not.toBeInTheDocument();
  });

  it("distinguishes 'no rules at all' from 'filters narrowed to zero'", async () => {
    mockUser("HR_ADMIN");
    mockedListEligibilityRules.mockResolvedValue([RULE]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();
    await waitFor(() => expect(screen.getByText("PHD")).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText("Search position, keyword, or notes"), "no such keyword");
    expect(await screen.findByText("No eligibility rules match these filters.")).toBeInTheDocument();
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

  it("hides Delete for a non-admin staff role", async () => {
    mockUser("CAMPUS_HOD");
    mockedListEligibilityRules.mockResolvedValue([RULE]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);

    renderPage();

    await waitFor(() => expect(screen.getByText("PHD")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Delete eligibility rule PHD" })).not.toBeInTheDocument();
  });

  it("deletes a rule via the confirm dialog and refreshes the list", async () => {
    mockUser("HR_ADMIN");
    mockedListEligibilityRules.mockResolvedValue([RULE]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedDeleteEligibilityRule.mockResolvedValue(undefined);

    renderPage();
    await waitFor(() => expect(screen.getByText("PHD")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Delete eligibility rule PHD" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(mockedDeleteEligibilityRule).toHaveBeenCalledWith("rule-1"));
  });

  it("surfaces a delete failure inline in the dialog", async () => {
    mockUser("SUPER_ADMIN");
    mockedListEligibilityRules.mockResolvedValue([RULE]);
    mockedListCampuses.mockResolvedValue([CAMPUS]);
    mockedDeleteEligibilityRule.mockRejectedValue(new ApiError(404, "Not found"));

    renderPage();
    await waitFor(() => expect(screen.getByText("PHD")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Delete eligibility rule PHD" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(within(dialog).getByText("Not found")).toBeInTheDocument());
  });
});
