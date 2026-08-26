import type { EligibilityRuleStatus, RegulatoryAuthority } from "@/api/types";

// Shared enum-label vocabulary for EligibilityRulesPage, EligibilityRuleDetailDrawer,
// and the create/edit form (all 3 need the exact same human-readable copy for
// RegulatoryAuthority/EligibilityRuleStatus) -- kept in one place rather than
// re-derived per component. Labels mirror app/models/enums.py's own
// RegulatoryAuthorityEnum/EligibilityRuleStatusEnum docstrings; see that file
// for the full reasoning behind each value (e.g. why UGC_AICTE_INSTITUTION and
// UNMAPPED_VERIFY are genuinely distinct "ambiguous" vs. "not yet mapped"
// cases, not synonyms).

export const REGULATORY_AUTHORITY_LABELS: Record<RegulatoryAuthority, string> = {
  AICTE_UGC: "AICTE + UGC",
  COA: "Council of Architecture (COA)",
  UGC: "UGC",
  UGC_AICTE_INSTITUTION: "UGC/AICTE (determine per programme)",
  NCTE_UGC: "NCTE + UGC",
  INSTITUTION_NON_TEACHING: "Institution (Non-Teaching)",
  INSTITUTION_HR_HOUSEKEEPING: "Institution HR (Housekeeping)",
  UNMAPPED_VERIFY: "Not yet mapped — verify manually",
};

export const REGULATORY_AUTHORITIES: RegulatoryAuthority[] = [
  "AICTE_UGC",
  "COA",
  "UGC",
  "UGC_AICTE_INSTITUTION",
  "NCTE_UGC",
  "INSTITUTION_NON_TEACHING",
  "INSTITUTION_HR_HOUSEKEEPING",
  "UNMAPPED_VERIFY",
];

export const ELIGIBILITY_RULE_STATUS_LABELS: Record<EligibilityRuleStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  ARCHIVED: "Archived",
};

export const ELIGIBILITY_RULE_STATUSES: EligibilityRuleStatus[] = ["DRAFT", "ACTIVE", "ARCHIVED"];

export function formatBoolean(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value ? "Yes" : "No";
}

// Date-only ISO strings ("YYYY-MM-DD") -- same `new Date(value).toLocaleDateString()`
// convention as SanctionedStrengthPage/TeachingStrengthTable's own `formatDate`.
export function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

// Radix `Select` can't hold an empty-string item value, so the create/edit
// form's genuinely-nullable booleans (net_set_required/id_proof_required/
// phd_required -- `bool | None` on the backend) use this 3-way sentinel
// instead of a native checkbox's true/false-only state.
export type TriState = "UNSET" | "TRUE" | "FALSE";

export function triStateToBool(value: TriState): boolean | null {
  if (value === "TRUE") return true;
  if (value === "FALSE") return false;
  return null;
}

export function boolToTriState(value: boolean | null | undefined): TriState {
  if (value === true) return "TRUE";
  if (value === false) return "FALSE";
  return "UNSET";
}
