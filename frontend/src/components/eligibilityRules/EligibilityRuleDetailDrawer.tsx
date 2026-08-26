import type { ReactNode } from "react";

import type { EligibilityRule } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ELIGIBILITY_RULE_STATUS_LABELS,
  REGULATORY_AUTHORITY_LABELS,
  formatBoolean,
  formatDate,
} from "@/components/eligibilityRules/labels";

// Read-only "View" drawer (backend Phase 1 + frontend Phase 2 redesign) --
// slide-in right-side panel, same Dialog/DialogContent-with-a-className-
// override technique as SanctionedStrengthDrawer.tsx (fixed right panel, no
// separate Radix Drawer primitive -- see that component's own docstring for
// the full rationale). Unlike SanctionedStrengthDrawer this has no tabs and
// no write mode -- Edit stays a fully separate action (the existing
// Dialog-based create/edit form in EligibilityRulesPage), so this component
// only ever renders, never mutates.
//
// Shows the COMPLETE field set grouped into 6 sections per the redesign
// task's own spec: Identity, Regulatory, Qualification, Experience,
// Keywords, Workflow. The Keywords section carries an explicit, visible
// caveat -- required_keywords/preferred_keywords are informational only and
// are NEVER consulted by app/services/eligibility.py::check_qualification_mismatch
// (only required_qualification_keyword drives the live eligibility check) --
// styled as a distinct muted note box, not a plain field, so nobody mistakes
// this page for a decision engine.

export interface EligibilityRuleDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: EligibilityRule | null;
  campusLabel: string;
  departmentLabel: string;
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-border pb-5 last:border-b-0 last:pb-0">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</dl>
    </section>
  );
}

function categorySpecificFields(rule: EligibilityRule): ReactNode {
  // Only the field(s) relevant to this row's own staff_category are
  // typically populated -- see app/schemas/eligibility_rule.py's own
  // docstring on EligibilityRuleBase. Rendered unconditionally (each still
  // falls back to "—" when unset) so switching staff_category never hides a
  // stray value entered under a different category by mistake.
  if (rule.staff_category === "TEACHING") {
    return (
      <>
        <Field label="Subject" value={rule.subject ?? "—"} />
        <Field label="NET/SLET required" value={formatBoolean(rule.net_set_required)} />
      </>
    );
  }
  if (rule.staff_category === "NON_TEACHING") {
    return <Field label="Skills keyword" value={rule.skills_keyword ?? "—"} />;
  }
  return (
    <>
      <Field label="ID proof required" value={formatBoolean(rule.id_proof_required)} />
      <Field label="Shift preference" value={rule.shift_preference ?? "—"} />
    </>
  );
}

export function EligibilityRuleDetailDrawer({
  open,
  onOpenChange,
  rule,
  campusLabel,
  departmentLabel,
}: EligibilityRuleDetailDrawerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed inset-y-0 top-0 left-auto right-0 flex h-full w-[26rem] max-w-full translate-x-0 translate-y-0 flex-col gap-4 overflow-hidden rounded-none border-l border-border p-6">
        <DialogHeader>
          <DialogTitle>{rule?.position_title ?? "Eligibility rule"}</DialogTitle>
        </DialogHeader>

        {rule ? (
          <div className="flex-1 overflow-y-auto pr-1">
            <div className="flex flex-col gap-5">
              <Section title="Identity">
                <Field label="Campus" value={campusLabel} />
                <Field label="Department" value={departmentLabel} />
                <Field label="Staff category" value={rule.staff_category.replace(/_/g, " ")} />
                <Field label="Position title" value={rule.position_title ?? "All positions"} />
              </Section>

              <Section title="Regulatory">
                <Field
                  label="Regulatory authority"
                  value={rule.regulatory_authority ? REGULATORY_AUTHORITY_LABELS[rule.regulatory_authority] : "—"}
                />
                <Field label="School / College" value={rule.school_or_college ?? "—"} />
                <Field label="Programme / Discipline" value={rule.programme_discipline ?? "—"} />
                <Field label="Source regulation" value={rule.source_regulation ?? "—"} />
              </Section>

              <Section title="Qualification">
                <Field label="Required qualification keyword" value={rule.required_qualification_keyword} />
                <Field label="Minimum qualification" value={rule.minimum_qualification ?? "—"} />
                <Field label="Minimum percentage" value={rule.minimum_percentage ?? "—"} />
                <Field label="PhD required" value={formatBoolean(rule.phd_required)} />
                <Field label="Required credential" value={rule.required_credential ?? "—"} />
                <Field label="Professional registration" value={rule.professional_registration ?? "—"} />
                {categorySpecificFields(rule)}
              </Section>

              <Section title="Experience">
                <Field label="Required experience" value={rule.required_experience ?? "—"} />
                <Field label="Industry experience" value={rule.industry_experience ?? "—"} />
              </Section>

              <Section title="Keywords">
                <div className="col-span-2 rounded-md border border-brand-warning/30 bg-brand-warning/10 px-3 py-2 text-xs text-brand-warning">
                  Informational only — not used to decide eligibility. The live eligibility check only evaluates
                  the Required Qualification Keyword field above.
                </div>
                <Field label="Required keywords" value={rule.required_keywords ?? "—"} />
                <Field label="Preferred keywords" value={rule.preferred_keywords ?? "—"} />
              </Section>

              <Section title="Workflow">
                <Field
                  label="Status"
                  value={<Badge variant="outline">{ELIGIBILITY_RULE_STATUS_LABELS[rule.status]}</Badge>}
                />
                <Field
                  label="Active"
                  value={<Badge variant={rule.is_active ? "success" : "destructive"}>{rule.is_active ? "Active" : "Inactive"}</Badge>}
                />
                <Field label="Verification required" value={formatBoolean(rule.verification_required)} />
                <Field label="Priority" value={rule.priority ?? "—"} />
                <Field label="Effective from" value={formatDate(rule.effective_from)} />
                <Field label="Effective to" value={formatDate(rule.effective_to)} />
                <div className="col-span-2">
                  <Field label="Notes" value={rule.notes ?? "—"} />
                </div>
              </Section>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
