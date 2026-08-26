import { apiFetch, apiFetchBlob } from "@/api/client";
import type {
  EligibilityRule,
  EligibilityRuleBulkUploadCommitResponse,
  EligibilityRuleBulkUploadValidationResponse,
  EligibilityRuleCreatePayload,
  EligibilityRuleListResponse,
  EligibilityRuleStatus,
  EligibilityRuleUpdatePayload,
  RegulatoryAuthority,
  StaffRoleCategory,
} from "@/api/types";

// Rewritten (starter regulatory-eligibility-rules feature, frontend Phase 2)
// to match app/api/v1/routers/eligibility_rules.py's real, extended contract
// -- filters/search/sort/pagination on list, a single-item GET, duplicate,
// export, and the 3-endpoint bulk-upload shape every other master-data
// entity in this app already has. `listEligibilityRules` is the ONLY caller
// of this module's list function (EligibilityRulesPage + its own test --
// grepped, no bare-reference caller elsewhere the way listDepartments() still
// has), so unlike departments.ts's listDepartments()/listDepartmentsWithCounts()
// split, there's no need to keep a separate zero-argument function here --
// this one function's signature just changed outright.

// Mirrors app/api/v1/routers/eligibility_rules.py::_SORT_FIELDS exactly.
export type EligibilityRuleSortBy =
  | "position_title"
  | "staff_category"
  | "regulatory_authority"
  | "status"
  | "is_active"
  | "created_at";
export type EligibilityRuleSortDirection = "asc" | "desc";

export interface ListEligibilityRulesParams {
  limit?: number;
  offset?: number;
  campus_id?: string | null;
  department_id?: string | null;
  staff_category?: StaffRoleCategory | null;
  regulatory_authority?: RegulatoryAuthority | null;
  position_title?: string | null;
  // Mirrors the backend's own `status` query alias (maps onto the `status`
  // field) -- named `status` here too, not `rule_status`, since this is a
  // request param, not the row shape that needed to avoid a name collision.
  status?: EligibilityRuleStatus | null;
  is_active?: boolean | null;
  search?: string | null;
  sort_by?: EligibilityRuleSortBy;
  sort_dir?: EligibilityRuleSortDirection;
}

function buildListQuery(params: ListEligibilityRulesParams): URLSearchParams {
  const query = new URLSearchParams();
  query.set("limit", String(params.limit ?? 50));
  query.set("offset", String(params.offset ?? 0));
  if (params.campus_id) query.set("campus_id", params.campus_id);
  if (params.department_id) query.set("department_id", params.department_id);
  if (params.staff_category) query.set("staff_category", params.staff_category);
  if (params.regulatory_authority) query.set("regulatory_authority", params.regulatory_authority);
  if (params.position_title) query.set("position_title", params.position_title);
  if (params.status) query.set("status", params.status);
  if (params.is_active !== undefined && params.is_active !== null) {
    query.set("is_active", String(params.is_active));
  }
  if (params.search) query.set("search", params.search);
  if (params.sort_by) query.set("sort_by", params.sort_by);
  if (params.sort_dir) query.set("sort_dir", params.sort_dir);
  return query;
}

export async function listEligibilityRules(
  params: ListEligibilityRulesParams = {},
): Promise<EligibilityRuleListResponse> {
  return apiFetch<EligibilityRuleListResponse>(`/eligibility-rules?${buildListQuery(params).toString()}`);
}

export async function getEligibilityRule(id: string): Promise<EligibilityRule> {
  return apiFetch<EligibilityRule>(`/eligibility-rules/${id}`);
}

export async function createEligibilityRule(payload: EligibilityRuleCreatePayload): Promise<EligibilityRule> {
  return apiFetch<EligibilityRule>("/eligibility-rules", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateEligibilityRule(
  id: string,
  payload: EligibilityRuleUpdatePayload,
): Promise<EligibilityRule> {
  return apiFetch<EligibilityRule>(`/eligibility-rules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

// Mirrors POST /eligibility-rules/{id}/duplicate -- no request body. Always
// comes back status=DRAFT/is_active=false/verification_required=true
// regardless of the source rule's own values (server-enforced, not something
// this client needs to re-apply).
export async function duplicateEligibilityRule(id: string): Promise<EligibilityRule> {
  return apiFetch<EligibilityRule>(`/eligibility-rules/${id}/duplicate`, { method: "POST" });
}

// Mirrors DELETE /eligibility-rules/{id} -- SUPER_ADMIN/HR_ADMIN only. Soft
// delete with no dependency guard (nothing references an eligibility rule by
// id), so this always succeeds once the rule is found.
export async function deleteEligibilityRule(id: string): Promise<void> {
  await apiFetch<void>(`/eligibility-rules/${id}`, { method: "DELETE" });
}

// --- Export -----------------------------------------------------------------
// Mirrors GET /eligibility-rules/export -- same filters as listEligibilityRules
// minus pagination (every matching row is exported, not just one page).
// Gated `_staff_only` server-side, same as list_eligibility_rules itself --
// deliberately NOT restricted to canManage on the frontend either, same
// reasoning as Departments' own exportDepartments().

export type ExportEligibilityRulesParams = Omit<ListEligibilityRulesParams, "limit" | "offset">;

/** Downloads a Blob (auth-header-carrying) and triggers a browser save --
 * same pattern as departments.ts's own triggerDownload. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportEligibilityRules(params: ExportEligibilityRulesParams = {}): Promise<void> {
  const query = buildListQuery(params);
  query.delete("limit");
  query.delete("offset");
  const qs = query.toString();
  const blob = await apiFetchBlob(`/eligibility-rules/export${qs ? `?${qs}` : ""}`);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  triggerDownload(blob, `simats-eligibility-rules-${date}.xlsx`);
}

// --- Bulk upload (validate -> preview -> commit) -----------------------------
// Mirrors the entity-specific /eligibility-rules/bulk-upload/* endpoints
// (template/validate/commit -- SUPER_ADMIN/HR_ADMIN only, same as create/
// update/delete above). The batch-level history/error-report/original-file/
// undo endpoints deliberately stay in api/sanctionedStrength.ts (already
// entity-agnostic on the backend) -- EligibilityRuleBulkUploadDialog imports
// those directly from there, same reuse Departments/Locations rely on.

export async function downloadEligibilityRuleBulkUploadTemplate(): Promise<void> {
  const blob = await apiFetchBlob("/eligibility-rules/bulk-upload/template");
  triggerDownload(blob, "eligibility_rule_bulk_upload_template.xlsx");
}

export async function validateEligibilityRuleBulkUpload(
  file: File,
): Promise<EligibilityRuleBulkUploadValidationResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<EligibilityRuleBulkUploadValidationResponse>("/eligibility-rules/bulk-upload/validate", {
    method: "POST",
    body: formData,
  });
}

export async function commitEligibilityRuleBulkUpload(file: File): Promise<EligibilityRuleBulkUploadCommitResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<EligibilityRuleBulkUploadCommitResponse>("/eligibility-rules/bulk-upload/commit", {
    method: "POST",
    body: formData,
  });
}
