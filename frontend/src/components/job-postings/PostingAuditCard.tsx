import { useQuery } from "@tanstack/react-query";

import { listAuditLogs } from "@/api/auditLogs";
import type { JobPostingRead } from "@/api/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** "JOB_POSTING_SUBMITTED_FOR_REVIEW" -> "Submitted for review". */
function actionLabel(action: string): string {
  const text = action.replace(/^JOB_POSTING_/, "").replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Section H: who moved the posting through each stage, and -- for a viewer
 * holding ACTIVITY_LOG, which GET /audit-logs requires -- its audit entries. */
export function PostingAuditCard({ jobPosting, canViewActivity }: { jobPosting: JobPostingRead; canViewActivity: boolean }) {
  const { data: entries } = useQuery({
    queryKey: ["audit-logs", "JobPosting", jobPosting.id],
    queryFn: () => listAuditLogs({ entityType: "JobPosting", entityId: jobPosting.id, limit: 20 }),
    enabled: canViewActivity,
  });

  const trail = [
    { label: "Created", who: jobPosting.created_by_name, when: jobPosting.created_at },
    { label: "Submitted for review", who: jobPosting.submitted_for_review_by_name, when: jobPosting.submitted_for_review_at },
    { label: "Approved", who: jobPosting.approved_by_name, when: jobPosting.approved_at },
    { label: "Published", who: jobPosting.published_by_name, when: jobPosting.published_at },
    { label: "Last edited", who: jobPosting.last_edited_by_name, when: jobPosting.last_edited_at },
    { label: "Closed", who: null, when: jobPosting.closed_at },
  ].filter((item): item is { label: string; who: string | null; when: string } => Boolean(item.when));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit information</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <dl className="flex flex-col gap-2">
          {trail.map((item) => (
            <div key={item.label} className="flex flex-col">
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd>
                {new Date(item.when).toLocaleString()}
                {item.who ? <span className="text-muted-foreground"> by {item.who}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
        {canViewActivity ? (
          <div className="flex flex-col gap-1.5">
            <div className="text-xs font-medium text-muted-foreground">Activity</div>
            {!entries || entries.length === 0 ? (
              <p className="text-xs text-muted-foreground">No recorded activity.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {entries.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap justify-between gap-2 text-xs">
                    <span>{actionLabel(entry.action)}</span>
                    <span className="text-muted-foreground">{new Date(entry.created_at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
