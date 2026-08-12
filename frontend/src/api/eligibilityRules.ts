import { apiFetch } from "@/api/client";
import type {
  EligibilityRule,
  EligibilityRuleCreatePayload,
  EligibilityRuleUpdatePayload,
  PaginatedResponse,
} from "@/api/types";

export async function listEligibilityRules(): Promise<EligibilityRule[]> {
  const response = await apiFetch<PaginatedResponse<EligibilityRule>>("/eligibility-rules?limit=200");
  return response.items;
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

// Mirrors DELETE /eligibility-rules/{id} -- SUPER_ADMIN/HR_ADMIN only. Soft
// delete with no dependency guard (nothing references an eligibility rule by
// id), so this always succeeds once the rule is found.
export async function deleteEligibilityRule(id: string): Promise<void> {
  await apiFetch<void>(`/eligibility-rules/${id}`, { method: "DELETE" });
}
