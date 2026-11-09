import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listWaitingList } from "@/api/applicationOutcomes";
import type { DashboardPipelineExtras } from "@/api/dashboard";
import type { ApplicationOutcomeRow } from "@/api/types";
import { CandidateInitials } from "@/components/applications/CandidateInitials";
import { PromoteFromWaitlistDialog } from "@/components/applications/PromoteFromWaitlistDialog";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";
import { filterHref } from "@/components/talentPool/filterHref";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PREVIEW_COUNT = 3;
// Sheet people shown per group: the dashboard is meant to fit one screen.
const SHEET_PREVIEW_COUNT = 2;

// Key-screens redesign (2026-10-29): the mock-up's "Next on the waiting
// list" card -- the first few rows of the Rejected & Waiting List page, in
// the same order (vacancy, then rank). Promote is offered only while the
// vacancy has a free post; the backend refuses it otherwise anyway.
//
// 2026-11-09: sheet waiting-list people follow the app rows as two labelled
// groups (Final = Teaching, NTS = Non-teaching), never merged. They have no
// application to promote, so there is no Promote button; each name opens the
// Talent Pool register already filtered to Waiting List on that tab.
const SHEET_GROUPS = [
  { key: "teaching", label: "Teaching (Final tab)", tab: "TEACHING_FINAL" },
  { key: "non_teaching", label: "Non-teaching (NTS tab)", tab: "NTS" },
] as const;

export function WaitingListPreview({
  canPromote,
  sheetPreview = null,
  sheetOutcomes = null,
}: {
  canPromote: boolean;
  /** `talent_pool_waiting_preview` / `talent_pool_outcomes` from the page's
   * pipeline-extras query; null (or not loaded) means no sheet groups. */
  sheetPreview?: DashboardPipelineExtras["talent_pool_waiting_preview"];
  sheetOutcomes?: DashboardPipelineExtras["talent_pool_outcomes"];
}) {
  const queryClient = useQueryClient();
  const [promoting, setPromoting] = useState<ApplicationOutcomeRow | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["application-outcomes", "WAITING_LIST", "preview"],
    queryFn: () => listWaitingList({ limit: PREVIEW_COUNT }),
  });
  const rows = data?.items ?? [];
  const sheetGroups = SHEET_GROUPS.map((group) => ({ ...group, people: (sheetPreview?.[group.key] ?? []).slice(0, SHEET_PREVIEW_COUNT) })).filter(
    (group) => group.people.length > 0,
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 p-3 pb-1">
        <CardTitle className="font-display text-base">Next on the waiting list</CardTitle>
        <Link to="/rejected-waiting-list" className="text-sm font-semibold text-primary hover:underline">
          See all{data ? ` (${data.total})` : ""}
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col p-3 pt-0">
        {isLoading ? (
          <div role="status" aria-label="Loading waiting list" className="h-24 animate-pulse rounded bg-muted" />
        ) : rows.length === 0 && sheetGroups.length === 0 ? (
          <EmptyState message="Nobody is on the waiting list." />
        ) : (
          <>
            {rows.map((row) => (
              <div key={row.application_id} className="flex items-center gap-3 border-t border-border py-1.5 first:border-t-0">
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
            ))}
            <div className="grid grid-cols-1 gap-x-4 border-t border-border pt-1.5 first:border-t-0 first:pt-0 sm:grid-cols-2">
            {sheetGroups.map((group) => {
              const href = filterHref(group.tab, { status: "Waiting List" });
              const count = sheetOutcomes?.[group.key].waiting_list;
              return (
                <div key={group.key} role="group" aria-label={group.label} className="flex flex-col">
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold text-muted-foreground">
                    <span>{group.label}</span>
                    {count !== undefined ? <span>{count.toLocaleString()} waiting</span> : null}
                  </div>
                  {group.people.map((person) => (
                    <div key={person.id} className="flex items-center gap-2 py-1">
                      <CandidateInitials name={person.full_name} />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <Link to={href} className="truncate font-semibold hover:underline">
                          {person.full_name}
                        </Link>
                        <span className="truncate text-xs text-muted-foreground">
                          {[person.applied_post, person.dept_raw].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
            </div>
          </>
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
