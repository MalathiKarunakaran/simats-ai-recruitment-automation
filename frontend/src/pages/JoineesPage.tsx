import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BookOpen, Brush, Database, GraduationCap, HelpCircle, LogOut, RotateCcw, UserPlus, Users } from "lucide-react";
import { useCallback, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { NONE_KEY, getJoineeSummary, listJoinees, type JoineeRead } from "@/api/joiningRecords";
import { StatTile } from "@/components/dashboard/StatTile";
import { ActiveFiltersLine } from "@/components/joining/ActiveFiltersLine";
import { JoinedPerMonthChart } from "@/components/joining/JoinedPerMonthChart";
import { JoineeSheet } from "@/components/joining/JoineeSheet";
import {
  CATEGORY_LABELS,
  EMPLOYMENT_STATE_LABELS,
  LIST_ID,
  countHref,
  labelFor,
  monthLabel,
  syncLine,
  withParams,
} from "@/components/joining/joiningLinks";
import { SearchBox } from "@/components/joining/SearchBox";
import { BreakdownList } from "@/components/talentPool/BreakdownList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { Switch } from "@/components/ui/switch";
import { useScrollToHash } from "@/hooks/useScrollToHash";

/**
 * New Joinees (docs/specs/joining-screens.md, screen 1). Read-only over the
 * synced New Joinees sheet: tiles, joined-per-month bars and a by-campus
 * list, every count a link into the list below (which scrolls into view),
 * and a side sheet per joiner. Same shape as the Talent Pool page.
 */

const PATH = "/joinees";
const PAGE_SIZE = 25;
const MEANING = [
  "category",
  "employment_state",
  "campus_code",
  "joined_month",
  "flagged",
  "linked_talent_pool",
] as const;
const NO_CAMPUS = "No campus";

export function JoineesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const get = (key: string) => searchParams.get(key) ?? "";
  const includeInactive = get("include_inactive") === "true";
  const linkedParam = get("linked_talent_pool");
  const filters = {
    q: get("q"),
    category: get("category"),
    employmentState: get("employment_state"),
    campusCode: get("campus_code"),
    joinedMonth: get("joined_month"),
    flagged: get("flagged") === "true",
    linked: linkedParam === "true" ? true : linkedParam === "false" ? false : undefined,
    offset: Math.max(0, Number(get("offset")) || 0),
  };
  const [openJoinee, setOpenJoinee] = useState<JoineeRead | null>(null);

  const summaryQuery = useQuery({
    queryKey: ["joining-records", "joinees", "summary", includeInactive],
    queryFn: () => getJoineeSummary(includeInactive),
  });
  const listQuery = useQuery({
    queryKey: ["joining-records", "joinees", "list", searchParams.toString()],
    queryFn: () =>
      listJoinees({
        q: filters.q || undefined,
        category: filters.category || undefined,
        employment_state: filters.employmentState || undefined,
        campus_code: filters.campusCode || undefined,
        joined_month: filters.joinedMonth || undefined,
        flagged: filters.flagged || undefined,
        linked_talent_pool: filters.linked,
        include_inactive: includeInactive || undefined,
        limit: PAGE_SIZE,
        offset: filters.offset,
      }),
    placeholderData: keepPreviousData,
  });

  const summary = summaryQuery.data;
  const data = listQuery.data;
  useScrollToHash(LIST_ID, Boolean(summary) && (data !== undefined || listQuery.isError));

  const update = useCallback(
    (next: Record<string, string | boolean | number | undefined>) =>
      setSearchParams(withParams(searchParams, next), { replace: true }),
    [searchParams, setSearchParams],
  );
  const changeSearch = useCallback((q: string) => update({ q, offset: 0 }), [update]);
  const href = (set: Partial<Record<(typeof MEANING)[number], string>>) => countHref(PATH, MEANING, set, searchParams);

  const parts: string[] = [];
  if (filters.category) parts.push(`Category: ${labelFor(CATEGORY_LABELS, filters.category)}`);
  if (filters.employmentState) parts.push(`Status: ${labelFor(EMPLOYMENT_STATE_LABELS, filters.employmentState)}`);
  if (filters.campusCode) parts.push(`Campus: ${filters.campusCode === NONE_KEY ? NO_CAMPUS : filters.campusCode}`);
  if (filters.joinedMonth) parts.push(`Joined: ${monthLabel(filters.joinedMonth)}`);
  if (filters.flagged) parts.push("Flagged by the last sync");
  if (filters.linked === true) parts.push("Linked to Talent Pool");
  if (filters.linked === false) parts.push("Not linked to Talent Pool");
  if (filters.q) parts.push(`Search: “${filters.q}”`);
  if (includeInactive) parts.push("Including removed rows");

  const category = (key: string) => summary?.by_category[key] ?? 0;
  const state = (key: string) => summary?.by_employment_state[key] ?? 0;
  const loading = summaryQuery.isLoading;

  return (
    <div className="space-y-4 px-4 py-4 sm:px-6">
      <header className="min-w-0">
        <h1 className="flex items-center gap-2 font-display text-xl font-bold">
          <UserPlus className="h-5 w-5 text-brand-primary" aria-hidden="true" />
          New Joinees
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {summary ? syncLine(summary.last_sync_at) : "Loading…"}
          {summary && summary.flagged > 0 ? (
            <>
              {" · "}
              <Link to={href({ flagged: "true" })} className="text-foreground underline decoration-border underline-offset-2 hover:decoration-current">
                {summary.flagged.toLocaleString("en-IN")} {summary.flagged === 1 ? "row" : "rows"} flagged by the last sync
              </Link>
            </>
          ) : null}
        </p>
      </header>

      {summaryQuery.isError ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <p className="text-xs text-brand-danger">
              {summaryQuery.error instanceof Error ? summaryQuery.error.message : "Could not load the joiners summary"}
            </p>
            <Button variant="outline" size="sm" onClick={() => void summaryQuery.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : summary && summary.total === 0 && !includeInactive ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium">No joiners synced yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              This page fills from the New Joinees sheet once its sync has run (Administration &rarr; Data Sync Status).
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div data-testid="joinee-tiles" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            <StatTile label="Total joiners" value={summary?.total} subLine="in the New Joinees sheet" icon={Users} accent="blue" to={href({})} isLoading={loading} />
            <StatTile label="Teaching" value={category("TEACHING")} icon={GraduationCap} to={href({ category: "TEACHING" })} isLoading={loading} />
            <StatTile label="Non-teaching" value={category("NON_TEACHING")} icon={BookOpen} to={href({ category: "NON_TEACHING" })} isLoading={loading} />
            <StatTile label="Housekeeping" value={category("HOUSEKEEPING")} icon={Brush} to={href({ category: "HOUSEKEEPING" })} isLoading={loading} />
            <StatTile label="No category" value={category(NONE_KEY)} subLine="e.g. JRF, or unrecognised type" icon={HelpCircle} accent="orange" to={href({ category: NONE_KEY })} isLoading={loading} />
            <StatTile label="Left" value={state("LEFT")} icon={LogOut} accent="red" to={href({ employment_state: "LEFT" })} isLoading={loading} />
            <StatTile label="Rejoined" value={state("REJOINED")} icon={RotateCcw} accent="green" to={href({ employment_state: "REJOINED" })} isLoading={loading} />
            <StatTile label="Linked to Talent Pool" value={summary?.linked_talent_pool} subLine="matched by mobile number at sync" icon={Database} to={href({ linked_talent_pool: "true" })} isLoading={loading} />
          </div>

          {summary ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardContent className="p-3">
                  <h2 className="mb-2 text-sm font-semibold">Joined per month</h2>
                  <JoinedPerMonthChart
                    data={summary.monthly}
                    undated={summary.undated}
                    monthHref={(month) => href({ joined_month: month })}
                    undatedHref={href({ joined_month: "undated" })}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <BreakdownList
                    title="By campus"
                    items={summary.by_campus.map((item) => ({
                      label: item.value === NONE_KEY ? NO_CAMPUS : item.value,
                      count: item.count,
                    }))}
                    hrefFor={(label) => href({ campus_code: label === NO_CAMPUS ? NONE_KEY : label })}
                    emptyMessage="No joiners yet."
                  />
                </CardContent>
              </Card>
            </div>
          ) : null}

          <section id={LIST_ID} className="scroll-mt-4 space-y-3">
            <h2 className="text-sm font-semibold">Joiners</h2>
            <div className="flex flex-wrap items-center gap-2">
              <SearchBox value={filters.q} onChange={changeSearch} placeholder="Search name, BIO ID, staff ID, designation, department" label="Search joiners" />
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={includeInactive}
                  onCheckedChange={(checked) => update({ include_inactive: checked, offset: 0 })}
                  aria-label="Show removed rows"
                />
                Show removed rows
              </label>
            </div>

            <ActiveFiltersLine
              parts={parts}
              total={data?.total}
              noun={["joiner", "joiners"]}
              onClear={() => setSearchParams(new URLSearchParams(), { replace: true })}
            />

            {listQuery.isError ? (
              <p className="text-xs text-brand-danger">
                {listQuery.error instanceof Error ? listQuery.error.message : "Could not load the joiners"}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table data-testid="joinee-table" className="w-full min-w-[48rem] text-xs">
                  <thead className="bg-card">
                    <tr className="border-b border-border text-left">
                      <th scope="col" className="px-2 py-1.5 font-medium">Name</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Category</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Campus</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Designation / department</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Joined</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data && data.items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">
                          No joiners match these filters.
                        </td>
                      </tr>
                    ) : null}
                    {data?.items.map((j) => (
                      <tr
                        key={j.id}
                        tabIndex={0}
                        onClick={() => setOpenJoinee(j)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setOpenJoinee(j);
                          }
                        }}
                        className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                      >
                        <td className="px-2 py-1.5">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{j.full_name ?? "(no name)"}</span>
                            {!j.is_active ? <Badge variant="warning">Removed from sheet</Badge> : null}
                            {j.talent_pool_entry_id ? <Badge variant="info">Talent Pool</Badge> : null}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {[j.bio_id && `BIO ${j.bio_id}`, j.staff_id && `Staff ${j.staff_id}`].filter(Boolean).join(" · ") || "—"}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">{labelFor(CATEGORY_LABELS, j.category)}</td>
                        <td className="px-2 py-1.5">{j.campus_code ?? j.college_raw ?? "—"}</td>
                        <td className="px-2 py-1.5">
                          {j.designation ?? "—"}
                          {j.department_raw ? <span className="block text-[11px] text-muted-foreground">{j.department_raw}</span> : null}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">{j.joined_on ?? j.joined_on_raw ?? "—"}</td>
                        <td className="px-2 py-1.5">
                          <Badge variant={j.employment_state === "LEFT" ? "warning" : j.employment_state === "REJOINED" ? "info" : j.employment_state === "ACTIVE" ? "success" : "default"}>
                            {labelFor(EMPLOYMENT_STATE_LABELS, j.employment_state)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {data && data.total > PAGE_SIZE ? (
              <Pagination
                total={data.total}
                limit={PAGE_SIZE}
                offset={filters.offset}
                onOffsetChange={(offset) => update({ offset })}
                itemLabel="joiners"
              />
            ) : null}
          </section>

          <JoineeSheet joinee={openJoinee} onClose={() => setOpenJoinee(null)} />
        </>
      )}
    </div>
  );
}
