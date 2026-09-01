import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FileSpreadsheet, FileUp, Plus, QrCode, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { listApprovedVacancies } from "@/api/approvedVacancies";
import { listAuditLogs } from "@/api/auditLogs";
import { listCampuses } from "@/api/campuses";
import { ApiError } from "@/api/client";
import { listDepartments } from "@/api/departments";
import { listJobPostings } from "@/api/jobPostings";
import type {
  VacancyRequestSource,
  EmploymentType,
  StaffRoleCategory,
  VacancyPriority,
  VacancyRequestRead,
  VacancyRequestStatus,
} from "@/api/types";
import { USER_MANAGEMENT_ROLES } from "@/api/types";
import { listUsers } from "@/api/users";
import { listVacancyRequests, submitVacancyRequest } from "@/api/vacancyRequests";
import { useAuth } from "@/auth/AuthContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { VacancyRequestBulkUploadDialog } from "@/components/vacancyRequests/VacancyRequestBulkUploadDialog";
import { VacancyRequestQrPanel } from "@/components/vacancyRequests/VacancyRequestQrPanel";
import { AccordionItem } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { CategoryTabs } from "@/components/domain/CategoryTabs";
import { DepartmentSummaryCard, type DepartmentSummary } from "@/components/vacancy-requests/DepartmentSummaryCard";
import { DepartmentVacancyDetailTable, type FillStats } from "@/components/vacancy-requests/DepartmentVacancyDetailTable";
import { PriorityBadge } from "@/components/vacancy-requests/PriorityBadge";
import { StatusBadge } from "@/components/vacancy-requests/StatusBadge";
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

// One role tuple, two gates: the backend splits vacancy writing into
// _can_create (CREATE_VACANCY_REQUEST) and _can_edit
// (EDIT_VACANCY_REQUEST), both OR'd with this same pair of roles.
const CAN_WRITE_ROLES = ["CAMPUS_HOD", "SUPER_ADMIN"];
const CAN_IMPORT_ROLES = ["HR_ADMIN", "SUPER_ADMIN"];
const AUDIT_READ_ROLES = ["SUPER_ADMIN", "HR_ADMIN", "ASSOCIATE_DEAN_RECRUITMENT", "CAMPUS_HOD"];

// Same labels as CategoryTabs/DesignationsPage -- used for the
// category-aware empty-state copy ("No Housekeeping Vacancy Requests" etc.).
const CATEGORY_LABELS: Record<StaffRoleCategory, string> = {
  TEACHING: "Teaching",
  NON_TEACHING: "Non-Teaching",
  HOUSEKEEPING: "Housekeeping",
};

type ViewMode = "FLAT" | "GROUPED";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Compact "Sanctioned Strength -> Vacancy Request -> Approval -> Published ->
// Closed" strip -- deliberately not a big graphic (per the redesign brief),
// just a subtle text strip under the page header. Folds in the old
// "Posts available to request come from Sanctioned Strength" paragraph's
// link functionality as the first step, rather than keeping both.
const WORKFLOW_STEPS: { label: string; to?: string }[] = [
  { label: "Sanctioned Strength", to: "/sanctioned-strength" },
  { label: "Vacancy Request" },
  { label: "Approval" },
  { label: "Published" },
  { label: "Closed" },
];

function WorkflowIndicator() {
  return (
    <div className="-mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {WORKFLOW_STEPS.map((step, index) => (
        <span key={step.label} className="flex items-center gap-1.5">
          {step.to ? (
            <Link to={step.to} className="font-medium text-primary underline-offset-2 hover:underline">
              {step.label}
            </Link>
          ) : (
            <span>{step.label}</span>
          )}
          {index < WORKFLOW_STEPS.length - 1 ? (
            <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          ) : null}
        </span>
      ))}
    </div>
  );
}

export function VacancyRequestsListPage() {
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  // Phase E item 28/29: SanctionedStrengthPage's clickable Recruitment/
  // Approval Status badges and VacancyRequestDetailPage's reverse link both
  // land here as ?department=X(&designation=Y) -- read once on mount, same
  // idiom as InterviewCreatePage/OfferCreatePage's `searchParams.get(...)`
  // reads (not re-synced if the URL changes after that, same as those two).
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<VacancyRequestStatus | "ALL">("ALL");
  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  const [departmentFilter, setDepartmentFilter] = useState<string>(() => searchParams.get("department") ?? "ALL");
  // Was a derived (setter-less) constant before this redesign -- now a real
  // useState (initialized from the deep link exactly like departmentFilter
  // above) so "Clear Filters" below can actually reset it. Still no visible
  // Select for it; the only way to set it remains the ?designation= deep
  // link, same as before.
  const [designationFilter, setDesignationFilter] = useState<string>(() => searchParams.get("designation") ?? "ALL");
  const [parentGroupFilter, setParentGroupFilter] = useState<string>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<VacancyPriority | "ALL">("ALL");
  // Source filter (2026-08-30) -- answers "where did this request come from":
  // MANUAL (raised in-app), BULK_UPLOAD, or QR (the public intake form).
  const [sourceFilter, setSourceFilter] = useState<VacancyRequestSource | "ALL">("ALL");
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
  // Flat table is the default (per the redesign brief); the parent-group
  // accordion + department card grid + drill-down detail table this page
  // used to show unconditionally is now opt-in behind this toggle, not
  // deleted -- it's still the only place that surfaces group totals, urgent
  // counts, and per-department fill stats, so it stays reachable rather than
  // silently dropping that information. See report/commit message for the
  // full rationale.
  const [viewMode, setViewMode] = useState<ViewMode>("FLAT");
  const [expandedParentGroups, setExpandedParentGroups] = useState<Set<string>>(new Set());
  const [expandedDepartmentId, setExpandedDepartmentId] = useState<string | null>(null);
  // Surfaces a failure from the flat table's inline "Submit" row action (see
  // below) -- a lightweight substitute for a toast/notification system,
  // which this codebase doesn't have.
  const [rowActionError, setRowActionError] = useState<string | null>(null);

  const canCreate = Boolean(
    user && (CAN_WRITE_ROLES.includes(user.role) || (hasPermission?.("CREATE_VACANCY_REQUEST") ?? false))
  );
  const canSubmitRow = Boolean(
    user && (CAN_WRITE_ROLES.includes(user.role) || (hasPermission?.("EDIT_VACANCY_REQUEST") ?? false))
  );
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
  // Fetched unfiltered (status=null) so the KPI strip above the table always
  // reflects the whole scope, independent of whatever the table's own
  // filters narrow down to below.
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

  // Reuses the same submit() mutation the detail page's "Submit" button
  // calls, with no override payload -- safe as a quick inline row action
  // because it needs no extra reason/justification for the common case
  // (submitVacancyRequest(id) with no body) and mirrors the exact same
  // gate as VacancyRequestDetailPage's canSubmit (CAMPUS_HOD/SUPER_ADMIN or
  // an individually granted EDIT_VACANCY_REQUEST, + status DRAFT, which is
  // exactly _can_edit on the backend's own submit endpoint -- no ownership
  // check either side).
  // A SUPER_ADMIN hitting the sanction-limit block still gets a real error
  // here (rowActionError) and can open the detail page for the override
  // dialog -- that path deliberately isn't duplicated inline.
  const submitRowMutation = useMutation({
    mutationFn: (vacancyRequestId: string) => submitVacancyRequest(vacancyRequestId),
    onSuccess: () => {
      setRowActionError(null);
      void queryClient.invalidateQueries({ queryKey: ["vacancy-requests"] });
    },
    onError: (err: unknown) => setRowActionError(err instanceof ApiError ? err.message : "Submit failed"),
  });

  const requesterNameById = useMemo(() => {
    const map = new Map<string, string>();
    requesters?.forEach((u) => map.set(u.id, u.full_name));
    return map;
  }, [requesters]);

  const campusById = useMemo(() => new Map((campuses ?? []).map((c) => [c.id, c])), [campuses]);

  // Bridges VacancyRequest -> ApprovedVacancy -> JobPosting (no direct FK on
  // VacancyRequestRead itself) to get each individual request's own
  // filled/remaining counts -- only consumed by the (opt-in) grouped view's
  // detail table and department cards below, not the default flat table.
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
  // Urgent and QR-submitted are NOT added to summarizeVacancyRequestStatuses.
  // That helper's contract is that its buckets partition the set -- every
  // status maps to exactly one, so they always sum to total (asserted in its
  // own test). Priority and source are orthogonal dimensions, not status
  // buckets, so folding them in would quietly destroy that invariant's
  // meaning. Computed here from the same unfiltered list instead.
  const urgentCount = useMemo(
    () => (vacancyRequests ?? []).filter((vr) => vr.priority === "URGENT").length,
    [vacancyRequests],
  );
  const qrSubmittedCount = useMemo(
    () => (vacancyRequests ?? []).filter((vr) => vr.source === "QR").length,
    [vacancyRequests],
  );

  const departmentById = useMemo(() => new Map((departments ?? []).map((d) => [d.id, d])), [departments]);

  // The one place that turns a department's own slice of (already
  // tab+filter-narrowed) requests into a DepartmentSummary -- used by the
  // grouped view's accordion cards, so it can never again show a count that
  // contradicts the flat table's own filtering (see CLAUDE.md A2/A5: they
  // used to be two independent computations with different "approved"
  // definitions and different "filled" sources).
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
    if (sourceFilter !== "ALL" && vr.source !== sourceFilter) return false;
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

  // Default sort for the flat table -- newest request first. Nothing else on
  // this page assumes a particular row order (the grouped view re-sorts its
  // own department cards by total, then designation groups by name), so this
  // is the one place ordering actually matters.
  const sortedFlatRequests = useMemo(
    () => [...filteredVacancyRequests].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [filteredVacancyRequests],
  );

  // Requests for the active tab/filters, bucketed by department -- feeds
  // both each DepartmentCard's own stats and (once a card is clicked) the
  // detailed vacancy table below the grid, in the (opt-in) grouped view.
  const requestsByDepartment = useMemo(() => {
    const map = new Map<string, typeof filteredVacancyRequests>();
    for (const vr of filteredVacancyRequests) {
      if (!map.has(vr.department_id)) map.set(vr.department_id, []);
      map.get(vr.department_id)!.push(vr);
    }
    return map;
  }, [filteredVacancyRequests]);

  // Parent Group (accordion) -> Department (card grid) hierarchy, one level
  // above the existing Department -> role/designation/campus grouping. Only
  // rendered when viewMode === "GROUPED".
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

  const activeFilterConditions = [
    statusFilter !== "ALL",
    campusFilter !== "ALL",
    departmentFilter !== "ALL",
    designationFilter !== "ALL",
    parentGroupFilter !== "ALL",
    priorityFilter !== "ALL",
    sourceFilter !== "ALL",
    employmentTypeFilter !== "ALL",
    requestedByFilter !== "ALL",
    dateFrom !== "",
    dateTo !== "",
    normalizedSearch !== "",
  ];
  const activeFilterCount = activeFilterConditions.filter(Boolean).length;
  const hasAnyFilter = activeFilterCount > 0;

  function clearFilters() {
    setStatusFilter("ALL");
    setSourceFilter("ALL");
    setCampusFilter("ALL");
    setDepartmentFilter("ALL");
    setDesignationFilter("ALL");
    setParentGroupFilter("ALL");
    setPriorityFilter("ALL");
    setEmploymentTypeFilter("ALL");
    setRequestedByFilter("ALL");
    setDateFrom("");
    setDateTo("");
    setSearch("");
  }

  const isEmpty = filteredVacancyRequests.length === 0;
  const emptyStateTitle = hasAnyFilter
    ? "No matching vacancy requests"
    : activeTab !== "ALL"
      ? `No ${CATEGORY_LABELS[activeTab]} Vacancy Requests`
      : "No Vacancy Requests Yet";

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
                      <li>
                        {/* Third intake method. Not a link to a form -- the
                            form is PUBLIC and reached by scanning; this jumps
                            to the panel that prints the code. */}
                        <a
                          href="#qr-request"
                          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          <QrCode className="h-4 w-4 shrink-0" />
                          Scan / QR Request
                        </a>
                      </li>
                    </>
                  ) : null}
                </ul>
              </PopoverContent>
            </Popover>
          )
        }
      />

      {canImport ? (
        <section id="qr-request" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">QR Request</h2>
            {/* The bulk-upload dialog lives here rather than only in the New
                request menu, so all three intake methods -- single entry,
                bulk upload, QR -- are visible in one place. */}
            <VacancyRequestBulkUploadDialog />
          </div>
          <VacancyRequestQrPanel />
        </section>
      ) : null}

      <WorkflowIndicator />

      {/* Every VacancyRequestStatus gets its own tile, either here (the 6
          primary buckets) or the compact secondary row just below -- see
          lib/vacancyRequestStats.ts. draft+pending+approved+published+
          closed+rejected+cancelled always sums to Total requests, so between
          the two rows no request is ever silently dropped into no bucket at
          all (CLAUDE.md A1). */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {/* The six the brief names. Draft/Published/Closed have not been
            deleted -- they moved to the secondary line below, the same way
            open_positions did on the executive dashboard, so no metric this
            page already showed is lost. */}
        <StatTile label="Total Requests" value={kpis.total} isLoading={isLoading} />
        <StatTile label="Pending" value={kpis.pending} isLoading={isLoading} accent="gold" />
        <StatTile label="Approved" value={kpis.approved} isLoading={isLoading} accent="green" />
        <StatTile label="Rejected" value={kpis.rejected} isLoading={isLoading} accent="red" />
        <StatTile label="Urgent" value={urgentCount} isLoading={isLoading} accent="red" />
        <StatTile label="QR Submitted" value={qrSubmittedCount} isLoading={isLoading} accent="blue" />
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>
          Draft <span className="font-semibold text-foreground tabular-nums">{kpis.draft}</span>
        </span>
        <span>
          Published <span className="font-semibold text-foreground tabular-nums">{kpis.published}</span>
        </span>
        <span>
          Closed <span className="font-semibold text-foreground tabular-nums">{kpis.closed}</span>
        </span>
        <span>
          Cancelled <span className="font-semibold text-foreground tabular-nums">{kpis.cancelled}</span>
        </span>
        <span>
          Departments{" "}
          <span className="font-semibold text-foreground tabular-nums">{departments?.length ?? 0}</span>
        </span>
        {canReadAuditLogs ? (
          <span>
            Bulk uploads today{" "}
            <span className="font-semibold text-foreground tabular-nums">{bulkUploadsToday}</span>
          </span>
        ) : null}
      </div>

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
                <SelectValue className="truncate" />
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
                <SelectValue className="truncate" />
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
                <SelectValue className="truncate" />
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
                <SelectValue className="truncate" />
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
                <SelectValue className="truncate" />
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
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">Source</span>
            <Select
              value={sourceFilter}
              onValueChange={(v) => setSourceFilter(v as VacancyRequestSource | "ALL")}
            >
              <SelectTrigger aria-label="Source filter">
                <SelectValue className="truncate" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All sources</SelectItem>
                <SelectItem value="MANUAL">Manual</SelectItem>
                <SelectItem value="BULK_UPLOAD">Bulk Upload</SelectItem>
                <SelectItem value="QR">QR</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* Bug fix (redesign spec item 5b): this trigger used to wrap "All
              vacancy types" onto two lines -- widened from w-40 and the value
              itself now truncates with an ellipsis instead of wrapping. */}
          <div className="w-48">
            <Select
              value={employmentTypeFilter}
              onValueChange={(v) => setEmploymentTypeFilter(v as EmploymentType | "ALL")}
            >
              <SelectTrigger aria-label="Vacancy type filter">
                <SelectValue className="truncate whitespace-nowrap" />
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
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
          {canResolveRequesterNames ? (
            // Bug fix (redesign spec item 5a): this trigger used to render
            // visibly taller than its siblings whenever a long requester
            // full name was selected, because the selected value wrapped
            // instead of truncating -- same `truncate` fix as above.
            <div className="w-44">
              <Select value={requestedByFilter} onValueChange={setRequestedByFilter}>
                <SelectTrigger aria-label="Requested by filter">
                  <SelectValue className="truncate" />
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
          <div className="ml-auto flex items-center gap-2">
            {hasAnyFilter ? (
              <span className="text-xs text-muted-foreground">
                {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} applied
              </span>
            ) : null}
            <Button variant="outline" size="sm" disabled={!hasAnyFilter} onClick={clearFilters} className="gap-1.5">
              <X className="h-3.5 w-3.5" />
              Clear filters
            </Button>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Showing {sortedFlatRequests.length} of {vacancyRequests?.length ?? 0} requests
        </p>
        <Tabs
          value={viewMode}
          onValueChange={setViewMode}
          tabs={[
            { value: "FLAT", label: "Flat view" },
            { value: "GROUPED", label: "Grouped view" },
          ]}
        />
      </div>

      {rowActionError ? <p className="text-sm text-destructive">{rowActionError}</p> : null}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : isEmpty ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm font-medium text-foreground">{emptyStateTitle}</p>
          {hasAnyFilter ? (
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : canCreate ? (
            <Button size="sm" asChild>
              <Link to="/vacancy-requests/new">
                <Plus className="h-4 w-4" />
                Create Vacancy Request
              </Link>
            </Button>
          ) : null}
        </div>
      ) : viewMode === "FLAT" ? (
        // UI redesign Phase 3 -- Card replaces the old bare
        // rounded-lg/border-border wrapper for the new radius/shadow
        // language. Scoped to just this FLAT-view table, not the whole
        // isLoading/isEmpty/FLAT/GROUPED ternary: the other 3 branches
        // already have their own appropriate treatments (isEmpty's dashed
        // empty-state box, GROUPED's accordion + DepartmentSummaryCard grid)
        // that a single outer Card would only clash with, not improve.
        //
        // Design-system-foundation step 5: the hand-rolled <table>/<thead>/
        // <tbody> markup itself is now the shared Table primitive (see
        // components/ui/table.tsx), same swap SanctionedStrengthPage made in
        // step 4 -- the fixed-width colgroup/table-fixed layout and every
        // per-cell className (truncate/whitespace-nowrap/tabular-nums/etc.)
        // carry over unchanged, only the element names changed.
        <Card>
          <CardContent className="p-0">
            <Table className="min-w-[1080px] table-fixed">
              <colgroup>
                <col className="w-24" />
                <col />
                <col className="w-28" />
                <col className="w-40" />
                <col className="w-20" />
                <col className="w-24" />
                {canResolveRequesterNames ? <col className="w-32" /> : null}
                <col className="w-24" />
                <col className="w-32" />
                <col className="w-28" />
                <col className="w-32" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead>Request ID</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Campus</TableHead>
                  <TableHead>Vacancies</TableHead>
                  {canResolveRequesterNames ? <TableHead>Requested By</TableHead> : null}
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Requested Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedFlatRequests.map((vr) => {
                  const department = departmentById.get(vr.department_id);
                  const campus = campusById.get(vr.campus_id);
                  const isSubmittingThisRow = submitRowMutation.isPending && submitRowMutation.variables === vr.id;
                  return (
                    <TableRow key={vr.id}>
                      {/* No human-readable request-number field exists on
                          VacancyRequestRead (see app/schemas/vacancy_request.py)
                          -- short form of the real id, full id on hover/title,
                          rather than inventing a field that isn't there. */}
                      <TableCell className="font-mono text-xs text-muted-foreground" title={vr.id}>
                        #{vr.id.slice(0, 8).toUpperCase()}
                      </TableCell>
                      <TableCell className="truncate font-medium text-foreground" title={vr.position_title}>
                        {vr.position_title}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{vr.role_category.replace(/_/g, " ")}</TableCell>
                      <TableCell className="truncate" title={department?.name}>
                        {department?.name ?? "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{campus?.code ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{vr.requested_count}</TableCell>
                      {canResolveRequesterNames ? (
                        <TableCell className="truncate">{requesterNameById.get(vr.requested_by_id) ?? "—"}</TableCell>
                      ) : null}
                      <TableCell className="whitespace-nowrap">
                        <PriorityBadge priority={vr.priority} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <StatusBadge status={vr.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{new Date(vr.created_at).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {canSubmitRow && vr.status === "DRAFT" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isSubmittingThisRow}
                              onClick={() => submitRowMutation.mutate(vr.id)}
                            >
                              {isSubmittingThisRow ? "Submitting…" : "Submit"}
                            </Button>
                          ) : null}
                          <Button variant="outline" size="sm" asChild>
                            <Link to={`/vacancy-requests/${vr.id}`}>View</Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
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
