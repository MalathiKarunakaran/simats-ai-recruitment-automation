import type { AuditLogRead } from "@/api/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function label(value: unknown): string {
  return typeof value === "string" ? value.replace(/_/g, " ").toLowerCase() : "";
}

const DOT_BY_STATUS: Record<string, string> = {
  WAITLISTED: "bg-brand-purple",
  REJECTED: "bg-destructive",
  WITHDRAWN: "bg-brand-warning",
  SELECTED: "bg-brand-success",
};

// The application's own trail from GET /audit-logs (key-screens redesign,
// 2026-10-29): each status change with its remarks, newest first. Shows the
// actor's role, as the Activity Log page does -- the log stores no name.
export function ApplicationActivity({ entries }: { entries: AuditLogRead[] }) {
  const changes = entries
    .filter((entry) => entry.action.startsWith("APPLICATION_STATUS_") || entry.action === "CREATE")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <Card>
      <CardHeader className="p-5 pb-2">
        <CardTitle className="font-display text-base">Activity</CardTitle>
      </CardHeader>
      <CardContent className="p-5 pt-1">
        {changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No status changes recorded yet.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col p-0">
            {changes.map((entry) => {
              const before = entry.before_state?.status;
              const after = entry.after_state?.status;
              const reason = entry.after_state?.reason ?? entry.after_state?.rejection_reason;
              const rank = after === "WAITLISTED" ? entry.after_state?.waitlist_rank : null;
              return (
                <li key={entry.id} className="flex gap-3 border-t border-border py-3 first:border-t-0">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                      (typeof after === "string" && DOT_BY_STATUS[after]) || "bg-primary",
                    )}
                  />
                  <div className="flex flex-col gap-0.5 text-sm">
                    <span>
                      {after ? (
                        <>
                          <strong className="capitalize">{before ? `${label(before)} → ${label(after)}` : label(after)}</strong>
                          {rank != null ? `, rank ${String(rank)}` : ""}
                          {entry.action === "APPLICATION_STATUS_FORCE_CORRECTION" ? " (forced correction)" : ""}
                        </>
                      ) : (
                        <strong>Application recorded</strong>
                      )}
                    </span>
                    {typeof reason === "string" && reason ? <span className="text-foreground/80">“{reason}”</span> : null}
                    <span className="text-xs text-muted-foreground">
                      {[label(entry.actor_role_snapshot), new Date(entry.created_at).toLocaleString()]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
