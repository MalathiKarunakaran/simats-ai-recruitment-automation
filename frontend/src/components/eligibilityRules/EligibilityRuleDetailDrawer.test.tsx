import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EligibilityRule } from "@/api/types";
import { EligibilityRuleDetailDrawer } from "@/components/eligibilityRules/EligibilityRuleDetailDrawer";

const RULE: EligibilityRule = {
  id: "rule-1",
  campus_id: "c-sse",
  department_id: "d-physics",
  staff_category: "TEACHING",
  position_title: "Assistant Professor",
  required_qualification_keyword: "PHD",
  net_set_required: true,
  // Deliberately distinct from the `departmentLabel` prop below ("Physics")
  // -- both render "Physics" as plain dd text if this collides, which makes
  // `getByText("Physics")` ambiguous (2 matches) rather than testing anything
  // useful about either field.
  subject: "Applied Physics",
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
  preferred_keywords: "research publications",
  phd_required: true,
  professional_registration: null,
  industry_experience: null,
  priority: "HIGH",
  effective_from: "2026-01-01",
  effective_to: null,
  source_regulation: "AICTE norms 2024",
  status: "DRAFT",
  verification_required: true,
  is_active: false,
  notes: "Spec example rule",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderDrawer(rule: EligibilityRule | null = RULE) {
  return render(
    <EligibilityRuleDetailDrawer
      open
      onOpenChange={vi.fn()}
      rule={rule}
      campusLabel="SSE"
      departmentLabel="Physics"
    />,
  );
}

describe("EligibilityRuleDetailDrawer", () => {
  it("renders every field group with real values", () => {
    renderDrawer();

    expect(screen.getByText("SSE")).toBeInTheDocument();
    expect(screen.getByText("Physics")).toBeInTheDocument();
    expect(screen.getByText("AICTE + UGC")).toBeInTheDocument();
    expect(screen.getByText("School of Engineering")).toBeInTheDocument();
    expect(screen.getByText("PHD")).toBeInTheDocument();
    expect(screen.getByText("PhD in Physics")).toBeInTheDocument();
    expect(screen.getByText("2 years")).toBeInTheDocument();
    expect(screen.getByText("physics, mechanics")).toBeInTheDocument();
    expect(screen.getByText("research publications")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByText("Spec example rule")).toBeInTheDocument();
  });

  it("visibly distinguishes the informational keyword fields from a real decision engine", () => {
    renderDrawer();

    expect(
      screen.getByText(/Informational only — not used to decide eligibility/),
    ).toBeInTheDocument();
  });

  it("falls back to '—' for unset optional fields", () => {
    renderDrawer({
      ...RULE,
      minimum_qualification: null,
      required_credential: null,
      professional_registration: null,
      required_experience: null,
      industry_experience: null,
      priority: null,
      notes: null,
    });

    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders nothing in the body when no rule is selected", () => {
    renderDrawer(null);

    expect(screen.queryByText("Identity")).not.toBeInTheDocument();
  });
});
