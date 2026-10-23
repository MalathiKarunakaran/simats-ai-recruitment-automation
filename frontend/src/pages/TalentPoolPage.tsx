import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Database, RefreshCw } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { getTalentPoolSummary } from "@/api/talentPool";
import type { TalentPoolSourceTab } from "@/api/types";
import { TalentPoolTiles } from "@/components/talentPool/TalentPoolTiles";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Talent Pool (2026-10-23), step B of docs/specs/talent-pool-dashboard.md.
 *
 * Reads Hermes's own `talent_pool_entries` and nothing else -- no Google
 * Sheets call, no Gmail. Everything here is read-only; there is deliberately
 * no control on this page that can edit a candidate, because the sheet is
 * the system of record and two editable copies cannot be reconciled.
 *
 * The tab lives in the URL (`?tab=nts`) so a link opens the same view, which
 * is also what lets the tiles be plain anchors rather than click handlers.
 *
 * Steps C and D add the chart, the department table, the breakdown panels
 * and the candidate register below the tiles.
 */

const STALE_AFTER_MINUTES = 60;

const TABS: { tab: TalentPoolSourceTab; param: string; label: string }[] = [
  { tab: "TEACHING_FINAL", param: "teaching", label: "Teaching" },
  { tab: "NTS", param: "nts", label: "Non-teaching" },
];

function tabFromParam(value: string | null): TalentPoolSourceTab {
  return value === "nts" ? "NTS" : "TEACHING_FINAL";
}

/** Asia/Calcutta, per spec 1.7 -- the sheet is maintained in IST and a
 * reader comparing this line against it should not have to convert. */
function formatSyncTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Calcutta",
  });
}

function minutesSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

export function TalentPoolPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const tab = tabFromParam(searchParams.get("tab"));
  const deptMode = searchParams.get("dept_mode") === "raw" ? "raw" : "group";

  const summaryQuery = useQuery({
    queryKey: ["talent-pool", "summary", tab, deptMode],
    queryFn: () => getTalentPoolSummary(tab, deptMode),
  });

  /** Switching tab clears the register filters (spec 1.1) -- a status that
   * exists on one sheet often does not exist on the other, so carrying them
   * across would silently show an empty register. */
  const selectTab = useCallback(
    (next: TalentPoolSourceTab) => {
      const params = new URLSearchParams();
      if (next === "NTS") params.set("tab", "nts");
      setSearchParams(params);
    },
    [setSearchParams],
  );

  /** Re-fetches what is on screen. It does NOT trigger a sync -- the n8n
   * workflow owns that, and a button that looked like it pulled from the
   * sheet but only re-read our own table would be a lie. */
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["talent-pool"] });
  }, [queryClient]);

  const summary = summaryQuery.data;

  const freshness = useMemo(() => {
    if (!summary) return null;
    const parts: string[] = ["Synced from Google Sheet"];
    parts.push(
      summary.last_sync_at ? `last sync ${formatSyncTime(summary.last_sync_at)}` : "never synced",
    );
    if (summary.sheet_last_update) parts.push(`sheet last updated ${summary.sheet_last_update}`);
    return parts.join(" \u00b7 ");
  }, [summary]);

  // Only a sync that HAS happened can be stale. A pool that has never synced
  // gets its own message below rather than being called infinitely stale.
  const isStale = Boolean(
    summary?.last_sync_at && minutesSince(summary.last_sync_at) > STALE_AFTER_MINUTES,
  );
  const neverSynced = Boolean(summary && !summary.last_sync_at);

  return (
    <div className="space-y-4 px-4 py-4 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-display text-xl font-bold">
            <Database className="h-5 w-5 text-brand-primary" aria-hidden="true" />
            Talent Pool
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {freshness ?? "Loading\u2026"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Staff category" className="flex rounded-md border border-border p-0.5">
            {TABS.map((option) => (
              <button
                key={option.param}
                type="button"
                role="tab"
                aria-selected={tab === option.tab}
                onClick={() => selectTab(option.tab)}
                className={cn(
                  "rounded px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  tab === option.tab
                    ? "bg-brand-primary text-white"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={summaryQuery.isFetching}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", summaryQuery.isFetching && "animate-spin")} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </header>

      {isStale ? (
        <Card className="border-l-4 border-l-brand-warning">
          <CardContent className="flex items-start gap-2 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-brand-warning" aria-hidden="true" />
            <p className="text-xs">
              The sheet hasn&apos;t synced since {formatSyncTime(summary!.last_sync_at!)}. Recent edits in
              the sheet are not shown yet. Check the n8n Talent Pool sync workflow.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {summaryQuery.isError ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <p className="text-xs text-brand-danger">
              {summaryQuery.error instanceof Error
                ? summaryQuery.error.message
                : "Could not load the talent pool summary"}
            </p>
            <Button variant="outline" size="sm" onClick={() => void summaryQuery.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : summaryQuery.isLoading ? (
        // Skeleton tiles rather than a spinner, so the row does not change
        // height when the numbers arrive.
        <TalentPoolTiles
          summary={{
            source_tab: tab,
            total: 0,
            by_status: {},
            by_eligibility: {},
            eligible_definition: ["With Ph.D"],
            eligible_pending: 0,
            by_department: [],
            department_mode: deptMode,
            department_count: 0,
            monthly: [],
            undated: 0,
            breakdowns: { source: [], called_by: [], eligibility: [], applied_post: [], call_outcomes: [] },
            last_sync_at: null,
            sheet_last_update: null,
            last_sync_counts: null,
          }}
          tab={tab}
          isLoading
        />
      ) : summary && summary.total === 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium">No candidates synced yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The Talent Pool fills from the Google Sheet every 15 minutes once the n8n workflow is
              running.
            </p>
            {neverSynced ? (
              <p className="mt-2 text-xs text-muted-foreground">
                No sync has run against this database yet.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : summary ? (
        <TalentPoolTiles summary={summary} tab={tab} />
      ) : null}
    </div>
  );
}
