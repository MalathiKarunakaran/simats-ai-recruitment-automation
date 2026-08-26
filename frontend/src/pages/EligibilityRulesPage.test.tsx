import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import { ApiError } from "@/api/client";
import * as departmentsApi from "@/api/departments";
import * as eligibilityRulesApi from "@/api/eligibilityRules";
import * as sanctionedStrengthApi from "@/api/sanctionedStrength";
import type { CampusRead, DepartmentRead, EligibilityRule, EligibilityRuleListResponse, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { ToastProvider } from "@/components/ui/toast";
import { EligibilityRulesPage } from "@/pages/EligibilityRulesPage";

// Rewritten wholesale (starter regulatory-eligibility-rules feature, frontend
// Phase 2) from the old thin client-side-filtered version -- now server-side
// pagination/sort/filter (mirroring DepartmentsPage.test.tsx's own rewrite
// shape), the full extended field set, the 3-dot row-actions Popover
// (View/Edit/Duplicate/Deactivate/Delete), the read-only detail drawer, and
// bulk-upload/upload-history/export actions.

vi.mock("@/api/campuses");
vi.mock("@/api/departments");
vi.mock("@/api/eligibilityRules");
vi.mock("@/api/sanctionedStrength");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedListDepartments = vi.mocked(departmentsApi.listDepartments);
const mockedListEligibilityRules = vi.mocked(eligibilityRulesApi.listEligibilityRules);
const mockedCreateEligibilityRule = vi.mocked(eligibilityRulesApi.createEligibilityRule);
const mockedUpdateEligibilityRule = vi.mocked(eligibilityRulesApi.updateEligibilityRule);
const mockedDeleteEligibilityRule = vi.mocked(eligibilityRulesApi.deleteEligibilityRule);
const mockedDuplicateEligibilityRule = vi.mocked(eligibilityRulesApi.duplicateEligibilityRule);
const mockedExportEligibilityRules = vi.mocked(eligibilityRulesApi.exportEligibilityRules);
const mockedListBulkUploads = vi.mocked(sanctionedStrengthApi.listSanctionedStrengthBulkUploads);

function mockUser(role: UserRead["role"] | null) {
  mockedUseAuth.mockReturnValue({
    user: role ? ({ id: "u-1", role, campus_id: null } as UserRead) : null,
    isLoading: false,
    login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
    logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
  });
}

const SSE: CampusRead = {
  id: "c-sse",
  code: "SSE",
  name: "Saveetha School of Engineering",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const SCLAS: CampusRead = { ...SSE, id: "c-sclas", code: "SCLAS" };

const PHYSICS: DepartmentRead = {
  id: "d-physics",
  campus_id: "c-sse",
  name: "Physics",
  code: "PHY",
  category: "TEACHING",
  parent_group: null,
  description: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const RULE: EligibilityRule = {
  id: "rule-1",
  campus_id: "c-sse",
  department_id: "d-physics",
  staff_category: "TEACHING",
  position_title: "Assistant Professor",
  required_qualification_keyword: "PHD",
  net_set_required: true,
  subject: "Physics",
  skills_keyword: null,
  id_proof_required: null,
  shift_preference: null,
  regulatory_authority: "AICTE_UGC",
  school_or_college: "School of Engineering",
  programme_discipline: "B.E. Physics",
  minimum_qualification: "PhD in Physics",
  minimum_percentage: "60%",
  required_experience: "2 years",
  required_credential: null,
  required_keywords: "physics, mechanics",
  preferred_keywords: "research",
  phd_required: true,
  professional_registration: null,
  industry_experience: null,
  priority: "HIGH",
  effective_from: "2026-01-01",
  effective_to: null,
  source_regulation: "AICTE norms 2024",
  status: "DRAFT",
  verification_required: true,
  is_active: true,
  notes: "Spec example rule",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function paginated(items: EligibilityRule[], total = items.length): EligibilityRuleListResponse {
  return { items, total, limit: 50, offset: 0 };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <EligibilityRulesPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("EligibilityRulesPage", () => {
  it("blocks a CANDIDATE-role account from viewing the page", async () => {
    mockUser("CANDIDATE");
    mockedListEligibilityRules.mockResolvedValue(paginated([RULE]));
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([PHYSICS]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Only staff can view eligibility rules.")).toBeInTheDocument());
  });

  it("lists rules with campus/authority/school/category/department/position/qualification/experience and both status badges", async () => {
    mockUser("HR_ADMIN");
    mockedListEligibilityRules.mockResolvedValue(paginated([RULE]));
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([PHYSICS]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.getByText("SSE")).toBeInTheDocument();
    expect(screen.getByText("AICTE + UGC")).toBeInTheDocument();
    expect(screen.getByText("School of Engineering")).toBeInTheDocument();
    expect(screen.getByText("Physics")).toBeInTheDocument();
    expect(screen.getByText("PHD")).toBeInTheDocument();
    expect(screen.getByText("2 years")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    // The keyword fields never render in the table -- only the drawer, with
    // its explicit "informational only" caveat -- so the list itself never
    // looks like it's driving a decision off them.
    expect(screen.queryByText("physics, mechanics")).not.toBeInTheDocument();
  });

  it("lets a non-admin staff role view rules read-only, with only View in the row-actions menu", async () => {
    mockUser("CAMPUS_HOD");
    mockedListEligibilityRules.mockResolvedValue(paginated([RULE]));
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([PHYSICS]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    expect(screen.queryByRole("button", { name: "New rule" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bulk upload" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /More actions/ }));
    expect(screen.getByRole("button", { name: "View" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Duplicate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("still shows Export to a role without ELIGIBILITY_RULE_MANAGEMENT_ROLES (mirrors the backend's broader staff-only export gate)", async () => {
    mockUser("CAMPUS_HOD");
    mockedListEligibilityRules.mockResolvedValue(paginated([RULE]));
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([PHYSICS]);

    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument());
  });

  it("shows a 'No eligibility rules found' empty state with New rule / Bulk upload CTAs when there are none at all", async () => {
    mockUser("SUPER_ADMIN");
    mockedListEligibilityRules.mockResolvedValue(paginated([]));
    mockedListCampuses.mockResolvedValue([]);
    mockedListDepartments.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("No eligibility rules found.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New rule" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Bulk upload" }).length).toBeGreaterThan(0);
  });

  it("opens the View drawer with the full field set, including the informational-keywords caveat", async () => {
    mockUser("HR_ADMIN");
    mockedListEligibilityRules.mockResolvedValue(paginated([RULE]));
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([PHYSICS]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /More actions/ }));
    await userEvent.click(await screen.findByRole("button", { name: "View" }));

    expect(await screen.findByText("physics, mechanics")).toBeInTheDocument();
    expect(screen.getByText(/Informational only — not used to decide eligibility/)).toBeInTheDocument();
  });

  it("narrows by campus, authority, category, department, position, and status filters", async () => {
    mockUser("HR_ADMIN");
    mockedListEligibilityRules.mockResolvedValue(paginated([RULE]));
    mockedListCampuses.mockResolvedValue([SSE, SCLAS]);
    mockedListDepartments.mockResolvedValue([PHYSICS]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));
    await waitFor(() =>
      expect(mockedListEligibilityRules).toHaveBeenLastCalledWith(expect.objectContaining({ campus_id: "c-sse" })),
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Regulatory authority filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "AICTE + UGC" }));
    await waitFor(() =>
      expect(mockedListEligibilityRules).toHaveBeenLastCalledWith(
        expect.objectContaining({ regulatory_authority: "AICTE_UGC" }),
      ),
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Category filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "TEACHING" }));
    await waitFor(() =>
      expect(mockedListEligibilityRules).toHaveBeenLastCalledWith(
        expect.objectContaining({ staff_category: "TEACHING" }),
      ),
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Department filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Physics" }));
    await waitFor(() =>
      expect(mockedListEligibilityRules).toHaveBeenLastCalledWith(
        expect.objectContaining({ department_id: "d-physics" }),
      ),
    );

    await userEvent.type(screen.getByLabelText("Position filter"), "Professor");
    await userEvent.tab();
    await waitFor(() =>
      expect(mockedListEligibilityRules).toHaveBeenLastCalledWith(
        expect.objectContaining({ position_title: "Professor" }),
      ),
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Status filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Draft" }));
    await waitFor(() =>
      expect(mockedListEligibilityRules).toHaveBeenLastCalledWith(expect.objectContaining({ status: "DRAFT" })),
    );
  }, 15000);

  it("commits the search box on blur, re-fetching and resetting to offset 0", async () => {
    mockUser("HR_ADMIN");
    mockedListEligibilityRules.mockResolvedValue(paginated([RULE]));
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([PHYSICS]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Search eligibility rules"), "Engineering");
    await userEvent.tab();

    await waitFor(() =>
      expect(mockedListEligibilityRules).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "Engineering", offset: 0 }),
      ),
    );
  });

  it("toggles sort direction on the Position column, resetting to offset 0", async () => {
    mockUser("HR_ADMIN");
    mockedListEligibilityRules.mockResolvedValue(paginated([RULE]));
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([PHYSICS]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    const positionHeader = screen.getByRole("columnheader", { name: /^Position/ });
    expect(positionHeader).toHaveAttribute("aria-sort", "none");

    await userEvent.click(screen.getByRole("button", { name: /^Position/ }));
    await waitFor(() =>
      expect(mockedListEligibilityRules).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort_by: "position_title", sort_dir: "asc", offset: 0 }),
      ),
    );
    await waitFor(() => expect(positionHeader).toHaveAttribute("aria-sort", "ascending"));
  });

  it("paginates with Previous/Next and the page-size selector", async () => {
    mockUser("HR_ADMIN");
    mockedListEligibilityRules.mockResolvedValue(paginated([RULE], 120));
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([PHYSICS]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(mockedListEligibilityRules).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })),
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Rows per page" }));
    await userEvent.click(await screen.findByRole("option", { name: "100" }));
    await waitFor(() =>
      expect(mockedListEligibilityRules).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: 100, offset: 0 }),
      ),
    );
  });

  it("shows a filter-applied indicator and a working Clear filters button", async () => {
    mockUser("HR_ADMIN");
    mockedListEligibilityRules.mockResolvedValue(paginated([RULE]));
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([PHYSICS]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    const clearButton = screen.getByRole("button", { name: /Clear filters/ });
    expect(clearButton).toBeDisabled();

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));

    expect(await screen.findByText("Filters applied")).toBeInTheDocument();
    expect(clearButton).not.toBeDisabled();

    await userEvent.click(clearButton);
    expect(screen.queryByText("Filters applied")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mockedListEligibilityRules).toHaveBeenLastCalledWith(expect.objectContaining({ campus_id: null })),
    );
  });

  it("shows a 'Clear filters' empty state when filters narrow the list to zero results", async () => {
    mockUser("HR_ADMIN");
    mockedListEligibilityRules.mockResolvedValueOnce(paginated([RULE]));
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([PHYSICS]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    mockedListEligibilityRules.mockResolvedValue(paginated([]));
    await userEvent.type(screen.getByLabelText("Search eligibility rules"), "Nonexistent");
    await userEvent.tab();

    expect(await screen.findByText("No eligibility rules match the current filters.")).toBeInTheDocument();
  });

  it("creates a rule with the campus and required qualification keyword filled in", async () => {
    mockUser("SUPER_ADMIN");
    mockedListEligibilityRules.mockResolvedValue(paginated([RULE]));
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([PHYSICS]);
    mockedCreateEligibilityRule.mockResolvedValue(RULE);

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "New rule" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New rule" }));
    const dialog = await screen.findByRole("dialog");
    // Scoped within the dialog, not `screen` -- the filter bar above it also
    // has several `combobox`-role Selects of its own (Campus filter etc.),
    // and Radix's Dialog content is portalled to the end of `document.body`,
    // so an unscoped `getAllByRole("combobox")[0]` would be ambiguous about
    // which Select it actually resolves to.
    const [campusTrigger] = within(dialog).getAllByRole("combobox");
    await userEvent.click(campusTrigger);
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));
    await userEvent.type(within(dialog).getByLabelText("Required qualification keyword"), "PHD");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create rule" }));

    await waitFor(() =>
      expect(mockedCreateEligibilityRule).toHaveBeenCalledWith(
        expect.objectContaining({
          campus_id: "c-sse",
          staff_category: "TEACHING",
          required_qualification_keyword: "PHD",
          status: "DRAFT",
          verification_required: true,
          is_active: true,
        }),
      ),
    );
  }, 10000);

  it("edits an existing rule via the row-actions menu", async () => {
    mockUser("HR_ADMIN");
    mockedListEligibilityRules.mockResolvedValue(paginated([RULE]));
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([PHYSICS]);
    mockedUpdateEligibilityRule.mockResolvedValue({ ...RULE, position_title: "Professor" });

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /More actions/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));

    const positionInput = screen.getByLabelText("Position title (optional)");
    await userEvent.clear(positionInput);
    await userEvent.type(positionInput, "Professor");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mockedUpdateEligibilityRule).toHaveBeenCalledWith(
        "rule-1",
        expect.objectContaining({ position_title: "Professor" }),
      ),
    );
  }, 10000);

  it("duplicates a rule, shows a toast, and opens the edit dialog on the new draft copy", async () => {
    mockUser("HR_ADMIN");
    mockedListEligibilityRules.mockResolvedValue(paginated([RULE]));
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([PHYSICS]);
    const duplicateRule: EligibilityRule = { ...RULE, id: "rule-2", status: "DRAFT", is_active: false };
    mockedDuplicateEligibilityRule.mockResolvedValue(duplicateRule);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /More actions/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Duplicate" }));

    await waitFor(() => expect(mockedDuplicateEligibilityRule).toHaveBeenCalledWith("rule-1"));
    expect(await screen.findByText(/Rule duplicated as a new draft/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("deactivates a rule via the row-actions menu without opening a confirm dialog", async () => {
    mockUser("HR_ADMIN");
    mockedListEligibilityRules.mockResolvedValue(paginated([RULE]));
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([PHYSICS]);
    mockedUpdateEligibilityRule.mockResolvedValue({ ...RULE, is_active: false });

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /More actions/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Deactivate" }));

    await waitFor(() => expect(mockedUpdateEligibilityRule).toHaveBeenCalledWith("rule-1", { is_active: false }));
    expect(await screen.findByText("Rule deactivated.")).toBeInTheDocument();
  });

  it("deletes a rule via the confirm dialog and refreshes the list", async () => {
    mockUser("HR_ADMIN");
    mockedListEligibilityRules.mockResolvedValue(paginated([RULE]));
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([PHYSICS]);
    mockedDeleteEligibilityRule.mockResolvedValue(undefined);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /More actions/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(mockedDeleteEligibilityRule).toHaveBeenCalledWith("rule-1"));
  });

  it("surfaces a delete failure inline in the dialog", async () => {
    mockUser("SUPER_ADMIN");
    mockedListEligibilityRules.mockResolvedValue(paginated([RULE]));
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([PHYSICS]);
    mockedDeleteEligibilityRule.mockRejectedValue(new ApiError(404, "Not found"));

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /More actions/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(within(dialog).getByText("Not found")).toBeInTheDocument());
  });

  it("exports eligibility rules with the current filters applied", async () => {
    mockUser("HR_ADMIN");
    mockedListEligibilityRules.mockResolvedValue(paginated([RULE]));
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([PHYSICS]);
    mockedExportEligibilityRules.mockResolvedValue(undefined);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SSE" }));
    await waitFor(() =>
      expect(mockedListEligibilityRules).toHaveBeenLastCalledWith(expect.objectContaining({ campus_id: "c-sse" })),
    );

    await userEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() =>
      expect(mockedExportEligibilityRules).toHaveBeenCalledWith(expect.objectContaining({ campus_id: "c-sse" })),
    );
  });

  it("opens the Upload history dialog scoped to ELIGIBILITY_RULE's own bulk-upload batches", async () => {
    mockUser("HR_ADMIN");
    mockedListEligibilityRules.mockResolvedValue(paginated([RULE]));
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedListDepartments.mockResolvedValue([PHYSICS]);
    mockedListBulkUploads.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Upload history" }));

    expect(await screen.findByText("Eligibility rule bulk upload history")).toBeInTheDocument();
    await waitFor(() =>
      expect(mockedListBulkUploads).toHaveBeenCalledWith(expect.objectContaining({ entity_type: "ELIGIBILITY_RULE" })),
    );
  });
});
