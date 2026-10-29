import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listWaitingList } from "@/api/applicationOutcomes";
import type { ApplicationOutcomeRow } from "@/api/types";
import { CandidateInitials } from "@/components/applications/CandidateInitials";
import { PromoteFromWaitlistDialog } from "@/components/applications/PromoteFromWaitlistDialog";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PREVIEW_COUNT = 3;

// Key-screens redesign (2026-10-29): the mock-up's "Next on the waiting
// list" card -- the first few rows of the Rejected & Waiting List page, in
// the same order (vacancy, then rank). Promote is offered only while the
// vacancy has a free post; the backend refuses it otherwise anyway.
export function WaitingListPreview({ canPromote }: { canPromote: boolean }) {
  const queryClient = useQueryClient();
  const [promoting, setPromoting] = useState<ApplicationOutcomeRow | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["application-outcomes", "WAITING_LIST", "preview"],
    queryFn: () => listWaitingList({ limit: PREVIEW_COUNT }),
  });
  const rows = data?.items ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 p-5 pb-2">
        <CardTitle className="font-display text-base">Next on the waiting list</CardTitle>
        <Link to="/rejected-waiting-list" className="text-sm font-semibold text-primary hover:underline">
          See all{data ? ` (${data.total})` : ""}
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col p-5 pt-1">
        {isLoading ? (
          <div role="status" aria-label="Loading waiting list" className="h-24 animate-pulse rounded bg-muted" />
        ) : rows.length === 0 ? (
          <EmptyState message="Nobody is on the waiting list." />
        ) : (
          rows.map((row) => (
            <div key={row.application_id} className="flex items-center gap-3 border-t border-border py-3 first:border-t-0">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-purple/10 text-xs font-bold text-[#4c1d95] dark:text-purple-300">
                {row.waitlist_rank ?? "—"}
              </span>
              <CandidateInitials name={row.candidate_name} />
              <div className="flex min-w-0 flex-1 flex-col">
                <Link to={`/applications/${row.application_id}`} className="truncate font-semibold hover:underline">
                  {row.candidate_name}
                </Link>
                <span className="truncate text-xs text-muted-foreground">
                  {[row.position_title, row.department_name, row.campus_code].filter(Boolean).join(" · ")}
                </span>
              </div>
              {canPromote ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={row.vacancy_open_slots === 0}
                  title={row.vacancy_open_slots === 0 ? "No free post on this vacancy" : undefined}
                  onClick={() => setPromoting(row)}
                >
                  Promote
                </Button>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
      {promoting ? (
        <PromoteFromWaitlistDialog
          applicationId={promoting.application_id}
          candidateName={promoting.candidate_name}
          open
          onOpenChange={(open) => {
            if (!open) setPromoting(null);
          }}
          onPromoted={() => {
            void queryClient.invalidateQueries({ queryKey: ["application-outcomes"] });
            void queryClient.invalidateQueries({ queryKey: ["dashboard-kpis"] });
          }}
        />
      ) : null}
    </Card>
  );
}
