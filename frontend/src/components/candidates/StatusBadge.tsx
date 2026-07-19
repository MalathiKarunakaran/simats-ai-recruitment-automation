import { Badge } from "@/components/ui/badge";

/** Mirrors the same terminal-state badge convention as
 * `components/employees/StatusBadge.tsx` and `components/applications/StatusBadge.tsx`
 * (REJECTED/WITHDRAWN application statuses use "destructive") -- candidate
 * withdraw is likewise a one-way, never-reactivated state. */
export function StatusBadge({ status }: { status: boolean }) {
  return <Badge variant={status ? "destructive" : "success"}>{status ? "Withdrawn" : "Active"}</Badge>;
}
