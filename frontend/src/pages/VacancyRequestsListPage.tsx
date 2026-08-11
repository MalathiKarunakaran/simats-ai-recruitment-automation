import { useQuery } from "@tanstack/react-query";
import { ChevronDown, FileSpreadsheet, FileUp, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { listApprovedVacancies } from "@/api/approvedVacancies";
import { listAuditLogs } from "@/api/auditLogs";
import { listCampuses } from "@/api/campuses";
import { listDepartments } from "@/api/departments";
import { listJobPostings } from "@/api/jobPostings";
import type {
  EmploymentType,
  VacancyPriority,
  VacancyRequestRead,
  VacancyRequestStatus,
} from "@/api/types";
import { USER_MANAGEMENT_ROLES } from "@/api/types";
import { listUsers } from "@/api/users";
import { listVacancyRequests } from "@/api/vacancyRequests";
import { useAuth } from "@/auth/AuthContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { AccordionItem } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CategoryTabs } from "@/components/domain/CategoryTabs";
import { DepartmentSummaryCard, type DepartmentSummary } from "@/components/vacancy-requests/DepartmentSummaryCard";
import { DepartmentVacancyDetailTable, type FillStats } from "@/components/vacancy-requests/DepartmentVacancyDetailTable";
import { StatTile } from "@/components/dashboard/StatTile";
import { useCategoryTabState } from "@/hooks/useCategoryTabState";
import { summarizeVacancyRequestStatuses } from "@/lib/vacancyRequestStats";

const UNGROUPED_LABEL = "Ungrouped";

const STATUSES: VacancyRequestStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "DEAN_APPROVED",
  "APPROVED",
  "PUBLISHED",
  "CLOSED",
  "REJECTED",
  "CANCELLED",
];
const PRIORITIES: VacancyPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];
const EMPLOYMENT_TYPES: EmploymentType[] = ["FULL_TIME", "PART_TIME", "CONTRACT", "VISITING", "ADJUNCT", "TRA", "JRF"];
// One audit action per bulk-import call (not per row) -- see
// app/services/tracker_import.py / migration.py's log_event calls.
const BULK_IMPORT_ACTIONS = ["TRACKER_WORKBOOK_IMPORTED", "LEGACY_VACANCIES_IMPORTED"];

const CAN_CREATE_ROLES = ["CAMPUS_HOD", "SUPER_ADMIN"];
const CAN_IMPORT_ROLES = ["HR_ADMIN", "SUPER_ADMIN"];
const AUDIT_READ_ROLES = ["SUPER_ADMIN", "HR_ADMIN", "ASSOCIATE_DEAN_RECRUITMENT", "CAMPUS_HOD"];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function VacancyRequestsListPage() {
  const { user } = useAuth();
  // Phase E item 28/29: SanctionedStrengthPage's clickable Recruitment/
  // Approval Status badges and VacancyRequestDetailPage's reverse link both
  // land here as ?department=X(&designation=Y) -- read once on mount, same
  // idiom as InterviewCreatePage/OfferCreatePage's `searchParams.get(...)`
  // reads (not re-synced if the URL changes after that, same as those two).
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<VacancyRequestStatus | "ALL">("ALL");
  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  const [departmentFilter, setDepartmentFilter] = useState<string>(() => searchParams.get("department") ?? "ALL");
  // No visible Select for this one (nothing in this page's filter bar lets a
  // user pick a single designation) -- it only ever comes from the deep
  // link's own URL, so a derived constant is enough; no setter needed.
  const designationFilter = searchParams.get("designation") ?? "ALL";
  const [parentGroupFilter, setParentGroupFilter] = useState<string>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<VacancyPriority | "ALL">("ALL");
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState<EmploymentType | "ALL">("ALL");
  const [requestedByFilter, setRequestedByFilter] = useState<string>("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  // Top-level All/Teaching/Non-Teaching/Housekeeping split -- supersedes the
  // old "Teaching & non-teaching" filter dropdown (that control is redundant
  // once the same axis is a top-level Tab; removed rather than keeping two
  // controls for one thing). URL-persisted via ?category=... (see
  // hooks/useCategoryTabState.ts) so the selection survives refresh/back-
  // forward/shared links.
  const [activeTab, setActiveTab] = useCategoryTabState();
  const [expandedParentGroups, setExpandedParentGroups] = useState<Set<string>>(new Set());
  const [expandedDepartmentId, setExpandedDepartmentId] = useState<string | null>(null);

  const canCreate = Boolean(user && CAN_CREATE_ROLES.includes(user.role));
  const canImport = Boolean(user && CAN_IMPORT_ROLES.includes(user.role));
  const canResolveRequesterNames = Boolean(user && USER_MANAGEMENT_ROLES.includes(user.role));
  const canReadAuditLogs = Boolean(user && AUDIT_READ_ROLES.includes(user.role));

  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });
  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: listDepartments });
  const { data: jobPostings } = useQuery({ queryKey: ["job-postings"], queryFn: listJobPostings });
  const { data: approvedVacancies } = useQuery({
    queryKey: ["approved-vacancies"],
    queryFn: listApprovedVacancies,
  });
  // Fetched unfiltered (status=null) so the KPI/department-summary counts
  // above the table always reflect the whole scope, independent of
  // whatever the table's own filters narrow down to below.
  const { data: vacancyRequests, isLoading } = useQuery({
    queryKey: ["vacancy-requests", "ALL"],
    queryFn: () => listVacancyRequests(null),
  });
  const { data: requesters } = useQuery({
    queryKey: ["users"],
    queryFn: listUsers,
    enabled: canResolveRequesterNames,
  });
  const todayStr = todayIso();
  const { data: todaysAuditLogs } = useQuery({
    queryKey: ["audit-logs", "vacancy-request-imports", todayStr],
    queryFn: () => listAuditLogs({ entityType: "VacancyRequest", startDate: todayStr, endDate: todayStr }),
    enabled: canReadAuditLogs,
  });

  const requesterNameById = useMemo(() => {
    const map = new Map<string, string>();
    requesters?.forEach((u) => map.set(u.id, u.full_name));
    return map;
  }, [requesters]);

  const campusById = useMemo(() => new Map((campuses ?? []).map((c) => [c.id, c])), [campuses]);

  // Bridges VacancyRequest -> ApprovedVacancy -> JobPosting (no direct FK on
  // VacancyRequestRead itself) to get each individual request's own
  // filled/remaining counts, not just the department-level aggregate above.
  const fillStatsByRequestId = useMemo(() => {
    const map = new Map<string, FillStats>();
    if (!approvedVacancies || !jobPostings) return map;
    const jobPostingByApprovedVacancyId = new Map(jobPostings.map((jp) => [jp.approved_vacancy_id, jp]));
    for (const av of approvedVacancies) {
      const jp = jobPostingByApprovedVacancyId.get(av.id);
      if (!jp) continue;
      // available_count is already the filled/staffed count directly, and
      // requested_count is already the still-needed count directly -- no
      // subtraction needed (unlike before, when available_count meant
      // "still open" and filled had to be derived by subtracting it from
      // the fixed total).
      map.set(av.vacancy_request_id, { filled: jp.available_count, remaining: jp.requested_count });
    }
    return map;
  }, [approvedVacancies, jobPostings]);

  const bulkUploadsToday = useMemo(
    () => (todaysAuditLogs ?? []).filter((log) => BULK_IMPORT_ACTIONS.includes(log.action)).length,
    [todaysAuditLogs],
  );

  // Single source of truth for every status-bucket count on this screen --
  // see lib/vacancyRequestStats.ts. The top KPI strip intentionally stays
  // scoped to the *whole* unfiltered set (not the active category tab),
  // matching this row's existing "always reflects the whole scope" design.
  const kpis = useMemo(() => summarizeVacancyRequestStatuses(vacancyRequests ?? []), [vacancyRequests]);

  const departmentById = useMemo(() => new Map((departments ?? []).map((d) => [d.id, d])), [departments]);

  // The one place that turns a department's own slice of (already
  // tab+filter-narrowed) requests into a DepartmentSummary -- used for both
  // the top horizontal-scroll card strip and the grouped accordion cards
  // below, so the two can never again show contradictory counts for the
  // same department (see CLAUDE.md A2/A5: they used to be two independent
  // computations with different "approved" definitions and different
  // "filled" sources -- one summed jobPostings by department, the other
  // summed the approvedVacancy->jobPosting bridge per request).
  function buildDepartmentSummary(departmentId: string, requests: VacancyRequestRead[]): DepartmentSummary {
    const buckets = summarizeVacancyRequestStatuses(requests);
    const lastRequestDate = requests.reduce<string | null>(
      (latest, r) => (!latest || r.created_at > latest ? r.created_at : latest),
      null,
    );
    return {
      departmentId,
      departmentName: departmentById.get(departmentId)?.name ?? "Unknown department",
      total: buckets.total,
      pending: buckets.pending,
      approved: buckets.approved,
      filled: requests.reduce((sum, r) => sum + (fillStatsByRequestId.get(r.id)?.filled ?? 0), 0),
      required: requests.reduce((sum, r) => sum + r.requested_count, 0),
      urgent: requests.filter((r) => r.priority === "URGENT").length,
      lastRequestDate,
    };
  }

  // Every distinct parent_group value present on any department, plus a
  // fixed "Ungrouped" bucket for the (currently most) departments that don't
  // have one set yet -- this is a brand-new optional column, don't silently
  // drop rows that lack it.
  const parentGroupOptions = useMemo(() => {
    const groups = new Set<string>();
    (departments ?? []).forEach((d) => {
      if (d.parent_group?.trim()) groups.add(d.parent_group.trim());
    });
    return Array.from(groups).sort((a, b) => a.localeCompare(b));
  }, [departments]);

  const normalizedSearch = search.trim().toLowerCase();
  // Every filter except the category tab -- shared between the final
  // filtered list and the CategoryTabs counts below, so each tab's count
  // reflects "how many would show up in this category, given the *other*
  // active filters", not the whole unfiltered set (same convention as
  // VacancyRegister/Designation Master's server-computed category_counts).
  function matchesNonCategoryFilters(vr: VacancyRequestRead): boolean {
    if (statusFilter !== "ALL" && vr.status !== statusFilter) return false;
    if (campusFilter !== "ALL" && vr.campus_id !== campusFilter) return false;
    if (departmentFilter !== "ALL" && vr.department_id !== departmentFilter) return false;
    if (designationFilter !== "ALL" && vr.designation_id !== designationFilter) return false;
    if (priorityFilter !== "ALL" && vr.priority !== priorityFilter) return false;
    if (employmentTypeFilter !== "ALL" && vr.employment_type !== employmentTypeFilter) return false;
    if (requestedByFilter !== "ALL" && vr.requested_by_id !== requestedByFilter) return false;
    if (dateFrom && vr.created_at.slice(0, 10) < dateFrom) return false;
    if (dateTo && vr.created_at.slice(0, 10) > dateTo) return false;
    if (normalizedSearch && !vr.position_title.toLowerCase().includes(normalizedSearch)) return false;
    if (parentGroupFilter !== "ALL") {
      const groupLabel = departmentById.get(vr.department_id)?.parent_group?.trim() || UNGROUPED_LABEL;
      if (groupLabel !== parentGroupFilter) return false;
    }
    return true;
  }

  const preCategoryFiltered = (vacancyRequests ?? []).filter(matchesNonCategoryFilters);
  const categoryTabCounts = {
    all: preCategoryFiltered.length,
    teaching: preCategoryFiltered.filter((vr) => vr.role_category === "TEACHING").length,
    nonTeaching: preCategoryFiltered.filter((vr) => vr.role_category === "NON_TEACHING").length,
    housekeeping: preCategoryFiltered.filter((vr) => vr.role_category === "HOUSEKEEPING").length,
  };
  const filteredVacancyRequests = preCategoryFiltered.filter(
    (vr) => activeTab === "ALL" || vr.role_category === activeTab,
  );

  // Requests for the active tab/filters, bucketed by department -- feeds
  // both each DepartmentCard's own stats and (once a card is clicked) the
  // detailed vacancy table below the grid. Also the shared upstream source
  // for the top summary-card strip below -- both now read from this exact
  // same tab+filter-narrowed map, so a department can never show one total
  // in the strip and a different total in the grouped accordion again (see
  // CLAUDE.md A4/A5: the strip used to be built from the raw, entirely
  // unfiltered list, ignoring both the active category tab and every other
  // filter, which is why its counts silently disagreed with the section
  // below it).
  const requestsByDepartment = useMemo(() => {
    const map = new Map<string, typeof filteredVacancyRequests>();
    for (const vr of filteredVacancyRequests) {
      if (!map.has(vr.department_id)) map.set(vr.department_id, []);
      map.get(vr.department_id)!.push(vr);
    }
    return map;
  }, [filteredVacancyRequests]);

  const departmentSummaries: DepartmentSummary[] = useMemo(
    () =>
      Array.from(requestsByDepartment.entries())
        .map(([departmentId, requests]) => buildDepartmentSummary(departmentId, requests))
        .sort((a, b) => b.total - a.total),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildDepartmentSummary closes over
    // departmentById/fillStatsByRequestId, both already in this deps list.
    [requestsByDepartment, departmentById, fillStatsByRequestId],
  );

  // Parent Group (accordion) -> Department (card grid) hierarchy, one level
  // above the existing Department -> role/designation/campus grouping.
  const parentGroupSections = useMemo(() => {
    const sections = new Map<string, DepartmentSummary[]>();
    for (const [departmentId, requests] of requestsByDepartment.entries()) {
      const department = departmentById.get(departmentId);
      const groupLabel = department?.parent_group?.trim() || UNGROUPED_LABEL;
      const summary = buildDepartmentSummary(departmentId, requests);
      if (!sections.has(groupLabel)) sections.set(groupLabel, []);
      sections.get(groupLabel)!.push(summary);
    }
    for (const cards of sections.values()) cards.sort((a, b) => a.departmentName.localeCompare(b.departmentName));
    return Array.from(sections.entries()).sort(([a], [b]) => {
      if (a === UNGROUPED_LABEL) return 1;
      if (b === UNGROUPED_LABEL) return -1;
      return a.localeCompare(b);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildDepartmentSummary closes over
    // departmentById/fillStatsByRequestId, both already in this deps list.
  }, [requestsByDepartment, departmentById, fillStatsByRequestId]);

  function toggleParentGroup(groupLabel: string) {
    setExpandedParentGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupLabel)) next.delete(groupLabel);
      else next.add(groupLabel);
      return next;
    });
  }

  function toggleExpandedDepartment(departmentId: string) {
    setExpandedDepartmentId((prev) => (prev === departmentId ? null : departmentId));
  }

  const hasAnyFilter =
    statusFilter !== "ALL" ||
    campusFilter !== "ALL" ||
    departmentFilter !== "ALL" ||
    designationFilter !== "ALL" ||
    parentGroupFilter !== "ALL" ||
    priorityFilter !== "ALL" ||
    employmentTypeFilter !== "ALL" ||
    requestedByFilter !== "ALL" ||
    dateFrom !== "" ||
    dateTo !== "" ||
    normalizedSearch !== "";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Vacancy Requests"
        description="Requests to fill sanctioned vacant posts. Track approval and publishing."
        actions={
          (canCreate || canImport) && (
            <Popover>
              <PopoverTrigger asChild>
                <Button className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  New request
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-1">
                <ul className="flex flex-col">
                  {canCreate ? (
                    <li>
                      <Link
                        to="/vacancy-requests/new"
                        className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                      >
                        <Plus className="h-4 w-4 shrink-0" />
                        Create individual request
                      </Link>
                    </li>
                  ) : null}
                  {canImport ? (
                    <>
                      <li>
                        <Link
                          to="/import-tracker"
                          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          <FileSpreadsheet className="h-4 w-4 shrink-0" />
                          Bulk upload Excel
                        </Link>
                      </li>
                      <li>
                        <Link
                          to="/vacancy-requests/import"
                          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          <FileUp className="h-4 w-4 shrink-0" />
                          Import previous template (CSV)
                        </Link>
                      </li>
                    </>
                  ) : null}
                </ul>
              </PopoverContent>
            </Popover>
          )
        }
      />

      <p className="-mt-3 text-sm text-muted-foreground">
        Posts available to request come from{" "}
        <Link to="/sanctioned-strength" className="font-medium text-primary underline-offset-2 hover:underline">
          Sanctioned Strength
        </Link>
        .
      </p>

      {/* Every VacancyRequestStatus gets its own tile below (see
          lib/vacancyRequestStats.ts) -- draft+pending+approved+published+
          closed+rejected+cancelled always sums to Total requests, so this
          row can never again silently drop a request into no bucket at all
          (CLAUDE.md A1). */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <StatTile label="Total requests" value={kpis.total} isLoading={isLoading} />
        <StatTile label="Draft" value={kpis.draft} isLoading={isLoading} />
        <StatTile label="Pending approval" value={kpis.pending} isLoading={isLoading} accent="gold" />
        <StatTile label="Approved" value={kpis.approved} isLoading={isLoading} accent="green" />
        <StatTile label="Published" value={kpis.published} isLoading={isLoading} accent="green" />
        <StatTile label="Closed" value={kpis.closed} isLoading={isLoading} />
        <StatTile label="Rejected" value={kpis.rejected} isLoading={isLoading} accent="orange" />
        <StatTile label="Cancelled" value={kpis.cancelled} isLoading={isLoading} accent="orange" />
        <StatTile label="Departments" value={departments?.length ?? 0} isLoading={!departments} />
        {canReadAuditLogs ? (
          <StatTile label="Bulk uploads today" value={bulkUploadsToday} isLoading={!todaysAuditLogs} />
        ) : null}
      </div>

      {departmentSummaries.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">Departments</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {departmentSummaries.map((summary) => (
              <DepartmentSummaryCard key={summary.departmentId} summary={summary} />
            ))}
          </div>
        </div>
      ) : null}

      <CategoryTabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value);
          setExpandedDepartmentId(null);
        }}
        counts={categoryTabCounts}
      />

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-64">
            <Input
              placeholder="Search position"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="w-48">
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger aria-label="Department filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All departments</SelectItem>
                {departments?.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <Select value={campusFilter} onValueChange={setCampusFilter}>
              <SelectTrigger aria-label="Campus filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All campuses</SelectItem>
                {campuses?.map((campus) => (
                  <SelectItem key={campus.id} value={campus.id}>
                    {campus.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-44">
            <Select value={parentGroupFilter} onValueChange={setParentGroupFilter}>
              <SelectTrigger aria-label="Parent group filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All parent groups</SelectItem>
                <SelectItem value={UNGROUPED_LABEL}>{UNGROUPED_LABEL}</SelectItem>
                {parentGroupOptions.map((group) => (
                  <SelectItem key={group} value={group}>
                    {group}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as VacancyRequestStatus | "ALL")}>
              <SelectTrigger aria-label="Status filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-36">
            <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v as VacancyPriority | "ALL")}>
              <SelectTrigger aria-label="Priority filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All priorities</SelectItem>
                {PRIORITIES.map((priority) => (
                  <SelectItem key={priority} value={priority}>
                    {priority}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <Select
              value={employmentTypeFilter}
              onValueChange={(v) => setEmploymentTypeFilter(v as EmploymentType | "ALL")}
            >
              <SelectTrigger aria-label="Vacancy type filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All vacancy types</SelectItem>
                {EMPLOYMENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canResolveRequesterNames ? (
            <div className="w-44">
              <Select value={requestedByFilter} onValueChange={setRequestedByFilter}>
                <SelectTrigger aria-label="Requested by filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Requested by anyone</SelectItem>
                  {requesters?.map((requester) => (
                    <SelectItem key={requester.id} value={requester.id}>
                      {requester.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              aria-label="Requested from date"
              className="w-36"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              aria-label="Requested to date"
              className="w-36"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : parentGroupSections.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {hasAnyFilter ? "No vacancy requests match these filters." : "No vacancy requests in this scope yet."}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {parentGroupSections.map(([groupLabel, cards]) => {
            const groupTotal = cards.reduce((sum, c) => sum + c.total, 0);
            const groupPending = cards.reduce((sum, c) => sum + c.pending, 0);
            const groupUrgent = cards.reduce((sum, c) => sum + (c.urgent ?? 0), 0);
            const expandedDepartmentInGroup =
              expandedDepartmentId && cards.some((c) => c.departmentId === expandedDepartmentId)
                ? expandedDepartmentId
                : null;

            return (
              <AccordionItem
                key={groupLabel}
                open={expandedParentGroups.has(groupLabel)}
                onToggle={() => toggleParentGroup(groupLabel)}
                trigger={
                  <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
                    <span className="font-semibold text-foreground">{groupLabel}</span>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span>
                        <span className="font-medium text-foreground">{cards.length}</span> departments
                      </span>
                      <span>
                        <span className="font-medium text-foreground">{groupTotal}</span> total
                      </span>
                      <span>
                        <span className="font-medium text-foreground">{groupPending}</span> pending
                      </span>
                      {groupUrgent > 0 ? <span className="text-destructive">{groupUrgent} urgent</span> : null}
                    </div>
                  </div>
                }
              >
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {cards.map((card) => (
                      <DepartmentSummaryCard
                        key={card.departmentId}
                        summary={card}
                        selected={expandedDepartmentId === card.departmentId}
                        onClick={() => toggleExpandedDepartment(card.departmentId)}
                      />
                    ))}
                  </div>

                  {expandedDepartmentInGroup ? (
                    <div className="border-t border-border pt-4">
                      <DepartmentVacancyDetailTable
                        requests={requestsByDepartment.get(expandedDepartmentInGroup) ?? []}
                        campusById={campusById}
                        fillStatsByRequestId={fillStatsByRequestId}
                        requesterNameById={requesterNameById}
                        canResolveRequesterNames={canResolveRequesterNames}
                      />
                    </div>
                  ) : null}
                </div>
              </AccordionItem>
            );
          })}
        </div>
      )}
    </div>
  );
}
