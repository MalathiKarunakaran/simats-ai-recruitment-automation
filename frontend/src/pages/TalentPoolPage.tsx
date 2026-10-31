import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Database, RefreshCw } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { getTalentPoolSummary } from "@/api/talentPool";
import type { TalentPoolEntryRead, TalentPoolSourceTab } from "@/api/types";
import { BreakdownList } from "@/components/talentPool/BreakdownList";
import { DepartmentTable } from "@/components/talentPool/DepartmentTable";
import { filterHref, type MeaningParam } from "@/components/talentPool/filterHref";
import { MonthlyAddedChart } from "@/components/talentPool/MonthlyAddedChart";
import { TalentPoolEntrySheet } from "@/components/talentPool/TalentPoolEntrySheet";
import { TalentPoolRegister, type RegisterFilters } from "@/components/talentPool/TalentPoolRegister";
import { TalentPoolTiles } from "@/components/talentPool/TalentPoolTiles";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useScrollToHash } from "@/hooks/useScrollToHash";
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

/** The Grouped / As-in-sheet choice is remembered per browser (spec 1.4).
 * Every access is wrapped: a private window, cleared site data or a browser
 * set to block storage makes these throw, and a remembered toggle is not
 * worth a blank page. */
const DEPT_MODE_KEY = "talent-pool.dept-mode";

function readStoredDeptMode(): "group" | "raw" | null {
  try {
    const stored = localStorage.getItem(DEPT_MODE_KEY);
    return stored === "raw" || stored === "group" ? stored : null;
  } catch {
    return null;
  }
}

function storeDeptMode(mode: "group" | "raw"): void {
  try {
    localStorage.setItem(DEPT_MODE_KEY, mode);
  } catch {
    // Ignored on purpose -- see DEPT_MODE_KEY.
  }
}

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
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const tab = tabFromParam(searchParams.get("tab"));

  // The URL wins when it says something, so a shared link opens the view it
  // describes; otherwise fall back to what this browser last chose.
  const urlDeptMode = searchParams.get("dept_mode");
  const deptMode: "group" | "raw" =
    urlDeptMode === "raw" || urlDeptMode === "group"
      ? urlDeptMode
      : (readStoredDeptMode() ?? "group");

  // Every register filter is URL state. That is what lets a tile and a
  // department row set them by linking, and what makes a pasted link
  // reproduce someone else's view exactly.
  const filters: RegisterFilters = useMemo(
    () => ({
      q: searchParams.get("q") ?? "",
      status: searchParams.get("status") ?? "",
      department: searchParams.get("department") ?? "",
      eligibility: searchParams.get("eligibility") ?? "",
      source: searchParams.get("source") ?? "",
      calledBy: searchParams.get("called_by") ?? "",
      appliedPost: searchParams.get("applied_post") ?? "",
      month: searchParams.get("month") ?? "",
      undecided: searchParams.get("undecided") === "true",
      includeInactive: searchParams.get("include_inactive") === "true",
      offset: Math.max(0, Number(searchParams.get("offset") ?? 0) || 0),
    }),
    [searchParams],
  );

  const [openEntry, setOpenEntry] = useState<TalentPoolEntryRead | null>(null);
  const [listLoaded, setListLoaded] = useState(false);

  const changeFilters = useCallback(
    (next: Partial<RegisterFilters>) => {
      const params = new URLSearchParams(searchParams);
      const write = (key: string, value: string | boolean | number | undefined) => {
        if (value === undefined) return;
        // An empty filter is absent from the URL rather than present and
        // blank, so a shared link carries only what was actually chosen.
        if (value === "" || value === false || value === 0) params.delete(key);
        else params.set(key, String(value));
      };
      write("q", next.q);
      write("status", next.status);
      write("department", next.department);
      write("eligibility", next.eligibility);
      write("source", next.source);
      write("called_by", next.calledBy);
      write("applied_post", next.appliedPost);
      write("month", next.month);
      write("undecided", next.undecided);
      write("include_inactive", next.includeInactive);
      write("offset", next.offset);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

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

  const selectDeptMode = useCallback(
    (mode: "group" | "raw") => {
      storeDeptMode(mode);
      const params = new URLSearchParams(searchParams);
      params.set("dept_mode", mode);
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  /** A department row click sets the register's department filter. It keeps
   * the current dept_mode, because the filter is matched against whichever
   * column the table was grouped by -- clicking "CSE" in Grouped and in
   * As-in-sheet are two different questions with two different answers. */
  const selectDepartment = useCallback(
    (department: string) => {
      const params = new URLSearchParams(searchParams);
      params.set("dept_mode", deptMode);
      params.set("department", department);
      // Back to page one: staying on page 4 of the old filter would show an
      // empty table and look like the filter found nothing.
      params.delete("offset");
      // With the #register hash, so the list scrolls into view like it does
      // for every other clickable count on this page.
      navigate({ pathname: location.pathname, search: `?${params.toString()}`, hash: "register" });
    },
    [deptMode, searchParams, navigate, location.pathname],
  );

  /** Re-fetches what is on screen. It does NOT trigger a sync -- the n8n
   * workflow owns that, and a button that looked like it pulled from the
   * sheet but only re-read our own table would be a lie. */
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["talent-pool"] });
  }, [queryClient]);

  const summary = summaryQuery.data;

  /** Every clickable count links to `#register`, but React Router does not
   * scroll to a hash -- and the register is at the very bottom, so without
   * this a click changed the list far out of sight and looked like it did
   * nothing. Waits for the summary (the register is not rendered until it
   * arrives) AND for the register's first page of rows: a fresh load of a
   * `#register` link used to scroll while the table was still empty, when
   * the page was too short to bring it to the top. See useScrollToHash. */
  const registerShown = Boolean(summary && summary.total > 0);
  useScrollToHash("register", registerShown && listLoaded);

  /** A breakdown row's link: that row's label as the one filter it means. */
  const linkFor = useCallback(
    (param: MeaningParam) => (label: string) => filterHref(tab, { [param]: label }, searchParams),
    [tab, searchParams],
  );

  const freshness = useMemo(() => {
    if (!summary) return null;
    // Never claim a sync that has not happened. Leading with "Synced from
    // Google Sheet" and then admitting "never synced" is a contradiction
    // that reads as a working sync at a glance -- and anyone skimming the
    // numbers would take them for the sheet's. When nothing has synced, say
    // plainly where the numbers did NOT come from.
    if (!summary.last_sync_at) {
      return summary.total > 0
        ? "Not synced from the Google Sheet yet \u2014 these numbers are whatever is already in this database, not the sheet."
        : "Not synced from the Google Sheet yet.";
    }
    const parts = ["Synced from Google Sheet", `last sync ${formatSyncTime(summary.last_sync_at)}`];
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
        <>
          <TalentPoolTiles summary={summary} tab={tab} currentParams={searchParams} />

          {/* Two columns on wide screens, stacked below -- the chart and the
              department table are the same altitude of question ("when" and
              "where"), so neither gets priority. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="p-3">
                <h2 className="mb-2 text-sm font-semibold">Candidates per month</h2>
                <MonthlyAddedChart
                  data={summary.monthly}
                  undated={summary.undated}
                  tab={tab}
                  monthHref={linkFor("month")}
                  undatedHref={linkFor("month")("undated")}
                />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-3">
                <DepartmentTable
                  rows={summary.by_department}
                  tab={tab}
                  deptMode={summary.department_mode === "raw" ? "raw" : "group"}
                  departmentCount={summary.department_count}
                  onDeptModeChange={selectDeptMode}
                  onSelectDepartment={selectDepartment}
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {tab === "TEACHING_FINAL" ? (
              <>
                <Card>
                  <CardContent className="p-3">
                    <BreakdownList
                      title="PhD / eligibility"
                      items={summary.breakdowns.eligibility}
                      subLine={`Eligible = ${summary.eligible_definition.join(" / ")}.`}
                      hrefFor={linkFor("eligibility")}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <BreakdownList title="Data source" items={summary.breakdowns.source} hrefFor={linkFor("source")} />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <BreakdownList
                      title="Interviews called by"
                      items={summary.breakdowns.called_by}
                      emptyMessage="No interviewer recorded against any candidate yet."
                      hrefFor={linkFor("called_by")}
                    />
                  </CardContent>
                </Card>
              </>
            ) : (
              <>
                <Card>
                  <CardContent className="p-3">
                    <BreakdownList
                      title="Applied post"
                      items={summary.breakdowns.applied_post}
                      hrefFor={linkFor("applied_post")}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <BreakdownList
                      title="Reference source"
                      items={summary.breakdowns.source}
                      hrefFor={linkFor("source")}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <BreakdownList
                      title="Call outcomes"
                      items={summary.breakdowns.call_outcomes}
                      hrefFor={linkFor("status")}
                    />
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          <TalentPoolRegister
            tab={tab}
            deptMode={summary.department_mode === "raw" ? "raw" : "group"}
            summary={summary}
            filters={filters}
            onFiltersChange={changeFilters}
            onOpenEntry={setOpenEntry}
            onListLoaded={setListLoaded}
          />

          <TalentPoolEntrySheet entry={openEntry} tab={tab} onClose={() => setOpenEntry(null)} />
        </>
      ) : null}
    </div>
  );
}
