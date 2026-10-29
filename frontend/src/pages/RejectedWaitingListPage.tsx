import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { exportRejected, exportWaitingList, listRejected, listWaitingList } from "@/api/applicationOutcomes";
import type { RejectedFilters } from "@/api/applicationOutcomes";
import { listCampuses } from "@/api/campuses";
import { APPLICATION_STATUS_ORDER, REJECTION_CATEGORY_LABELS } from "@/api/types";
import type { ApplicationOutcomeRow, ApplicationStatus, RejectionCategory } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { CandidateInitials } from "@/components/applications/CandidateInitials";
import { PromoteFromWaitlistDialog } from "@/components/applications/PromoteFromWaitlistDialog";
import { CategoryTabs } from "@/components/domain/CategoryTabs";
import type { CategoryTabValue } from "@/components/domain/CategoryTabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";

type View = "WAITING_LIST" | "REJECTED";

const PAGE_SIZE = 50;
// Same gate as ApplicationDetailPage's canWrite: the promotion is a PATCH
// /applications/{id}/status, require_permission(MANAGE_APPLICATIONS).
const WRITE_ROLES = ["RECRUITMENT_OFFICER", "HR_ADMIN", "SUPER_ADMIN", "RECRUITMENT_COORDINATOR"];
const REJECTION_STAGES: ApplicationStatus[] = [...APPLICATION_STATUS_ORDER];
const ALL = "ALL";

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

interface VacancyGroup {
  jobPostingId: string;
  rows: ApplicationOutcomeRow[];
}

// Rows arrive sorted by vacancy then rank, so one pass keeps both orders.
function groupByVacancy(rows: ApplicationOutcomeRow[]): VacancyGroup[] {
  const groups: VacancyGroup[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.jobPostingId === row.job_posting_id) last.rows.push(row);
    else groups.push({ jobPostingId: row.job_posting_id, rows: [row] });
  }
  return groups;
}

// "Slot held by Priya Raman — promotion opens if she withdraws" vs "1 post
// open — ready to promote": what a recruiter needs before pressing Promote.
function slotNote(row: ApplicationOutcomeRow): { text: string; open: boolean } {
  if (row.vacancy_open_slots > 0) {
    const n = row.vacancy_open_slots;
    return { text: `${n} post${n === 1 ? "" : "s"} open — ready to promote`, open: true };
  }
  const holders = row.vacancy_slot_holders;
  const who = holders.length === 0 ? "selected candidates" : holders.join(", ");
  return { text: `All posts held by ${who} — promotion opens if one is rejected or withdraws`, open: false };
}

export function RejectedWaitingListPage() {
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>("WAITING_LIST");
  const [category, setCategory] = useState<CategoryTabValue>("ALL");
  const [campusCode, setCampusCode] = useState(ALL);
  const [rejectionCategory, setRejectionCategory] = useState(ALL);
  const [stage, setStage] = useState(ALL);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [promoting, setPromoting] = useState<ApplicationOutcomeRow | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const canPromote = Boolean(
    user && (WRITE_ROLES.includes(user.role) || (hasPermission?.("MANAGE_APPLICATIONS") ?? false)),
  );

  const filters: RejectedFilters = {
    roleCategory: category === "ALL" ? null : category,
    campusCode: campusCode === ALL ? null : campusCode,
    ...(view === "REJECTED"
      ? {
          rejectionCategory: rejectionCategory === ALL ? null : (rejectionCategory as RejectionCategory),
          rejectedAtStage: stage === ALL ? null : (stage as ApplicationStatus),
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
        }
      : {}),
  };

  const { data, isLoading } = useQuery({
    queryKey: ["application-outcomes", view, filters, offset],
    queryFn: () =>
      view === "WAITING_LIST"
        ? listWaitingList({ ...filters, limit: PAGE_SIZE, offset })
        : listRejected({ ...filters, limit: PAGE_SIZE, offset }),
    placeholderData: keepPreviousData,
  });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });

  // Any filter change starts again at the first page.
  function changed<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setOffset(0);
    };
  }

  async function onExport() {
    setExportError(null);
    try {
      await (view === "WAITING_LIST" ? exportWaitingList(filters) : exportRejected(filters));
    } catch {
      setExportError("Export failed");
    }
  }

  const counts = data?.category_counts ?? {};
  const rows = data?.items ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] leading-tight font-extrabold tracking-tight">Rejected &amp; Waiting List</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Interviewed candidates held in reserve, and everyone turned down, with the reason.
          </p>
        </div>
        <Button variant="outline" onClick={() => void onExport()}>
          <Download className="size-4" aria-hidden />
          Export to Excel
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={view}
          onValueChange={changed(setView)}
          variant="segmented"
          tabs={[
            { value: "WAITING_LIST", label: "Waiting List" },
            { value: "REJECTED", label: "Rejected" },
          ]}
        />
        <CategoryTabs
          value={category}
          onValueChange={changed(setCategory)}
          counts={{
            all: counts.ALL ?? 0,
            teaching: counts.TEACHING ?? 0,
            nonTeaching: counts.NON_TEACHING ?? 0,
            housekeeping: counts.HOUSEKEEPING ?? 0,
          }}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Select value={campusCode} onValueChange={changed(setCampusCode)}>
            <SelectTrigger aria-label="Campus filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All campuses</SelectItem>
              {campuses?.map((campus) => (
                <SelectItem key={campus.id} value={campus.code}>
                  {campus.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {view === "REJECTED" ? (
          <>
            <div className="w-56">
              <Select value={rejectionCategory} onValueChange={changed(setRejectionCategory)}>
                <SelectTrigger aria-label="Reason filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All reasons</SelectItem>
                  {(Object.keys(REJECTION_CATEGORY_LABELS) as RejectionCategory[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {REJECTION_CATEGORY_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-56">
              <Select value={stage} onValueChange={changed(setStage)}>
                <SelectTrigger aria-label="Stage filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All stages</SelectItem>
                  {REJECTION_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {statusLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rejected_from">Rejected from</Label>
              <Input
                id="rejected_from"
                type="date"
                className="w-40"
                value={dateFrom}
                onChange={(e) => changed(setDateFrom)(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rejected_to">to</Label>
              <Input
                id="rejected_to"
                type="date"
                className="w-40"
                value={dateTo}
                onChange={(e) => changed(setDateTo)(e.target.value)}
              />
            </div>
          </>
        ) : null}
      </div>

      {exportError ? <p className="text-sm text-destructive">{exportError}</p> : null}

      {view === "WAITING_LIST" ? (
        isLoading ? (
          <div role="status" aria-label="Loading waiting list" className="h-40 animate-pulse rounded-xl bg-muted" />
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">Nobody is on the waiting list.</CardContent>
          </Card>
        ) : (
          groupByVacancy(rows).map((group) => {
            const first = group.rows[0];
            const note = slotNote(first);
            const posts = first.vacancy_total_positions;
            return (
              <section
                key={group.jobPostingId}
                aria-label={`${first.position_title} waiting list`}
                className="overflow-hidden rounded-xl border border-border bg-card"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-5 py-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-display text-base font-bold">
                      {[first.position_title, first.department_name].filter(Boolean).join(" · ")}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {[first.campus_code, first.posting_number, `${posts} post${posts === 1 ? "" : "s"}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  <span
                    className={
                      note.open
                        ? "rounded-full bg-brand-success/10 px-3 py-1.5 text-sm font-semibold text-[#14532d] dark:text-green-300"
                        : "rounded-full bg-brand-warning/10 px-3 py-1.5 text-sm font-semibold text-[#7c2d12] dark:text-amber-300"
                    }
                  >
                    {note.text}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <Table className="min-w-[640px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20 pl-5">Rank</TableHead>
                        <TableHead>Candidate</TableHead>
                        <TableHead>Interviewed</TableHead>
                        <TableHead>Panel remarks</TableHead>
                        {canPromote ? (
                          <TableHead className="pr-5">
                            <span className="sr-only">Action</span>
                          </TableHead>
                        ) : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.rows.map((row) => (
                        <TableRow key={row.application_id}>
                          <TableCell className="pl-5">
                            <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-purple/10 font-bold text-[#4c1d95] dark:text-purple-300">
                              {row.waitlist_rank ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <CandidateInitials name={row.candidate_name} />
                              <div className="flex flex-col">
                                <Link to={`/applications/${row.application_id}`} className="font-semibold hover:underline">
                                  {row.candidate_name}
                                </Link>
                                <span className="text-xs text-muted-foreground">{row.candidate_email}</span>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{formatDate(row.interview_date)}</TableCell>
                          <TableCell className="max-w-72 truncate" title={row.panel_remarks ?? undefined}>
                            {row.panel_remarks ?? "—"}
                          </TableCell>
                          {canPromote ? (
                            <TableCell className="pr-5 text-right">
                              <Button
                                size="sm"
                                variant={note.open ? "default" : "outline"}
                                disabled={!note.open}
                                onClick={() => setPromoting(row)}
                              >
                                {note.open ? "Promote to Selected" : "Promote"}
                              </Button>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            );
          })
        )
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Candidate</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>Campus</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Remarks</TableHead>
                    <TableHead className="pr-5">Rejected on</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableEmpty colSpan={7} loading />
                  ) : rows.length === 0 ? (
                    <TableEmpty colSpan={7}>No rejected applications match.</TableEmpty>
                  ) : (
                    rows.map((row) => (
                      <TableRow key={row.application_id}>
                        <TableCell className="pl-5">
                          <div className="flex items-center gap-3">
                            <CandidateInitials name={row.candidate_name} />
                            <div className="flex flex-col">
                              <Link to={`/applications/${row.application_id}`} className="font-semibold hover:underline">
                                {row.candidate_name}
                              </Link>
                              <span className="text-xs text-muted-foreground">{row.candidate_email}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {row.position_title}
                          <div className="text-xs text-muted-foreground">
                            {[row.department_name, row.posting_number].filter(Boolean).join(" · ")}
                          </div>
                        </TableCell>
                        <TableCell>{row.campus_code}</TableCell>
                        <TableCell>
                          {row.rejection_category ? REJECTION_CATEGORY_LABELS[row.rejection_category] : "Not recorded"}
                        </TableCell>
                        <TableCell>{row.rejected_at_stage ? statusLabel(row.rejected_at_stage) : "—"}</TableCell>
                        <TableCell className="max-w-64 truncate" title={row.rejection_remarks ?? undefined}>
                          {row.rejection_remarks ?? "—"}
                        </TableCell>
                        <TableCell className="pr-5">{formatDate(row.rejected_at)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {data && data.total > PAGE_SIZE ? (
        <Pagination
          total={data.total}
          limit={PAGE_SIZE}
          offset={offset}
          onOffsetChange={setOffset}
          itemLabel="applications"
        />
      ) : null}

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
            void queryClient.invalidateQueries({ queryKey: ["applications"] });
          }}
        />
      ) : null}
    </div>
  );
}
