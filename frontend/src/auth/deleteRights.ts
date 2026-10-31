// Deleting stays Super Admin only (user decision, 31-Oct-2026): the backend's
// refuse_coordinator_delete (app/core/deps.py) refuses a
// RECRUITMENT_COORDINATOR on every DELETE route, whatever permission they have
// been granted. Delete controls hide for them to match -- a UX affordance
// only, the backend re-checks. Every other role keeps its existing gate.
export function roleMayDelete(role: string | undefined): boolean {
  return role !== "RECRUITMENT_COORDINATOR";
}
