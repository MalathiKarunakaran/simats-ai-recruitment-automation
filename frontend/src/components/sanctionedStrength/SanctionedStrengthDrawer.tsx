import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { listAuditLogs } from "@/api/auditLogs";
import { ApiError } from "@/api/client";
import { listDesignations } from "@/api/designations";
import { listLocations } from "@/api/locations";
import {
  createSanctionedStrength,
  getDepartmentSanctionedStrengthBreakdown,
  getSanctionedStrengthAvailability,
  getSanctionedStrengthHistory,
  updateSanctionedStrength,
} from "@/api/sanctionedStrength";
import type { AuditLogRead, StaffRoleCategory } from "@/api/types";
import { listVacancyRequests } from "@/api/vacancyRequests";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, type TabOption } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Unified View/Add/Edit drawer (glowing-zooming-hamming.md Phase H) --
// replaces both SanctionedStrengthEditPopover.tsx and AddDesignationRow.tsx
// (deleted this same phase) across all 3 real usage sites: TeachingStrengthTable/
// NonTeachingStrengthTable's shared StrengthRowActions, and
// SanctionedStrengthPage.tsx's own DesignationRow/"Add designation" action.
// Housekeeping is explicitly out of scope (HousekeepingStrengthTable's own
// row grain has no single sanctioned_strength_id to target -- see that
// component's own docstring); this drawer is never mounted from there.
//
// Slide-in technique copied from SanctionedStrengthHistoryDrawer.tsx (now
// folded into this file's own History tab and deleted, since that was its
// only usage) -- Dialog/DialogContent + the same className-override
// approach (fixed right-side panel, no new dependency), just a wider panel
// (w-[26rem] vs. the original w-96) and a flex-column layout to fit a
// 7-tab body with a scrollable tab content area and a pinned footer.
//
// User-confirmed UX shape (see this phase's own dispatch): ONE trigger
// button per row replaces both the old pencil-Edit-popover trigger and the
// separate History button; "Raise vacancy request" moves inside this
// drawer's Recruitment Status tab as a CTA there, no longer a row-level
// link. Defaults to the Basic Info tab for a write-role (canManage) user,
// the History tab for a read-only viewer -- mirrors
// SanctionedStrengthEditPopover's own `readOnly` convention (a read-only
// viewer never saw an edit affordance at all, just Approved + History +
// the raise-link).
//
// Data-fetching shape: rather than threading effective_from/remarks/
// location_id/working/vacancy through props from 3 differently-shaped call
// sites (StrengthActionRow vs. DepartmentDesignationBreakdownRow), this
// drawer fetches its own department breakdown
// (getDepartmentSanctionedStrengthBreakdown, sharing the
// ["sanctioned-strength-breakdown", departmentId] cache key every other
// sanctioned-strength component already uses) and resolves the target
// designation's true current-effective row from that -- same lazy
// fetch-then-prefill technique TeachingStrengthTable's own StrengthRowActions
// already established, just centralized here instead of duplicated per
// caller. Every other tab's own query is gated on `activeTab === "<tab>"`
// (in addition to `open`) so opening the drawer never fires all 7 tabs'
// worth of requests at once -- only the breakdown (needed for Basic
// Info/Strength/Location together) is fetched eagerly on open.

export type SanctionedStrengthDrawerMode = "view" | "add" | "edit";

type DrawerTab = "basic" | "strength" | "location" | "recruitment" | "approval" | "history" | "audit";

const TAB_LABELS: Record<DrawerTab, string> = {
  basic: "Basic Info",
  strength: "Strength",
  location: "Location",
  recruitment: "Recruitment Status",
  approval: "Approval Status",
  history: "History",
  audit: "Audit Log",
};

const ALL_TABS: DrawerTab[] = ["basic", "strength", "location", "recruitment", "approval", "history", "audit"];

const NON_NEGATIVE_INTEGER = /^\d+$/;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatEnumLabel(value: string): string {
  return value
    .split("_")
    .map((word) => (word ? word.charAt(0) + word.slice(1).toLowerCase() : word))
    .join(" ");
}

function sourceLabel(source: string): string {
  return source === "BULK_UPLOAD" ? "Bulk Upload" : "Manual";
}

const NOT_YET_SANCTIONED_TEXT = "Not yet sanctioned";

export interface SanctionedStrengthDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: SanctionedStrengthDrawerMode;
  /** Mirrors SANCTIONED_STRENGTH_WRITE_ROLES on the caller -- gates every
   * write control (Approved/Effective from/Remarks/Location/Designation
   * inputs, the Save button) and drives the default tab. */
  canManage: boolean;
  /** Mirrors AUDIT_LOG_READ_ROLES on the caller -- hides the Audit Log tab
   * for a viewer who'd otherwise hit a 403 the moment they clicked it. */
  canViewAuditLog: boolean;
  campusId: string;
  campusLabel: string;
  departmentId: string;
  departmentLabel: string;
  category: StaffRoleCategory | null;
  /** null only in "add" mode, before a designation has been chosen in the
   * Basic Info tab. */
  designationId: string | null;
  /** Best-known display name before the breakdown query resolves the
   * authoritative one (which always wins once loaded). */
  designationName?: string | null;
  /** Invoked after a successful save, in addition to this drawer's own
   * built-in invalidation of the shared breakdown/register query keys --
   * lets a caller also invalidate its own view-specific query key (e.g.
   * TeachingStrengthTable's "teaching-strength-view"). */
  onSaved?: () => void;
}

export function SanctionedStrengthDrawer({
  open,
  onOpenChange,
  mode,
  canManage,
  canViewAuditLog,
  campusId,
  campusLabel,
  departmentId,
  departmentLabel,
  category,
  designationId: designationIdProp,
  designationName: designationNameProp,
  onSaved,
}: SanctionedStrengthDrawerProps) {
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<DrawerTab>("basic");
  const [selectedDesignationId, setSelectedDesignationId] = useState("");
  const [approvedStrength, setApprovedStrength] = useState("0");
  const [effectiveFrom, setEffectiveFrom] = useState(todayIsoDate());
  const [remarks, setRemarks] = useState("");
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const designationId = mode === "add" ? selectedDesignationId || null : designationIdProp;

  // Re-seed on every open, same convention as HousekeepingStaffFormDrawer's
  // own reseed effect -- this drawer is controlled from the outside and
  // stays mounted between opens.
  useEffect(() => {
    if (!open) return;
    setActiveTab(canManage ? "basic" : "history");
    setSelectedDesignationId(mode === "add" ? "" : (designationIdProp ?? ""));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, designationIdProp, canManage]);

  const designationsQuery = useQuery({
    queryKey: ["designations", category ?? "ALL"],
    queryFn: () => listDesignations(category ? { category } : {}),
    enabled: open,
  });
  const locationsQuery = useQuery({ queryKey: ["locations"], queryFn: listLocations, enabled: open });
  // Shared with every other sanctioned-strength component's own breakdown
  // fetch (same query key) -- needed for Basic Info/Strength/Location
  // regardless of which tab is active, so fetched eagerly on open rather
  // than gated per-tab like the others below.
  const breakdownQuery = useQuery({
    queryKey: ["sanctioned-strength-breakdown", departmentId],
    queryFn: () => getDepartmentSanctionedStrengthBreakdown(departmentId),
    enabled: open && Boolean(departmentId),
  });

  const breakdownRow = breakdownQuery.data?.find((row) => row.designation_id === designationId);
  const sanctionedStrengthId = breakdownRow?.sanctioned_strength_id ?? null;
  const working = breakdownRow?.working ?? 0;

  // Re-seed the form fields once the breakdown resolves (or immediately, to
  // blank defaults, for Add mode before a designation is chosen) -- separate
  // from the tab/selection reset above since this depends on an async fetch.
  useEffect(() => {
    if (!open) return;
    if (mode === "add" && !designationId) {
      setApprovedStrength("0");
      setEffectiveFrom(todayIsoDate());
      setRemarks("");
      setLocationId("");
      return;
    }
    if (!breakdownQuery.isSuccess) return;
    const row = breakdownQuery.data.find((candidate) => candidate.designation_id === designationId);
    setApprovedStrength(String(row?.approved ?? 0));
    setEffectiveFrom(row?.effective_from ?? todayIsoDate());
    setRemarks(row?.remarks ?? "");
    setLocationId(row?.location_id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, designationId, mode, breakdownQuery.isSuccess, breakdownQuery.data]);

  const excludeDesignationIds = new Set((breakdownQuery.data ?? []).map((row) => row.designation_id));
  const candidateDesignations = category
    ? (designationsQuery.data ?? []).filter((d) => d.category === category && !excludeDesignationIds.has(d.id))
    : [];
  const campusLocations = (locationsQuery.data ?? []).filter(
    (l) => l.campus_id === campusId && (l.category === null || l.category === category),
  );

  const resolvedDesignationName =
    breakdownRow?.designation_name ??
    designationsQuery.data?.find((d) => d.id === designationId)?.name ??
    designationNameProp ??
    "this designation";

  // --- Recruitment Status tab (lazy: only fetched while that tab is active) ---
  const availabilityQuery = useQuery({
    queryKey: ["sanctioned-strength-availability", campusId, departmentId, designationId],
    queryFn: () =>
      getSanctionedStrengthAvailability({ campusId, departmentId, designationId: designationId as string }),
    enabled: open && activeTab === "recruitment" && Boolean(designationId),
  });

  // --- Approval Status tab (lazy) ---
  const vacancyRequestsQuery = useQuery({
    queryKey: ["vacancy-requests-by-designation", departmentId, designationId],
    queryFn: () => listVacancyRequests(null, { departmentId, designationId }),
    enabled: open && activeTab === "approval" && Boolean(designationId),
  });

  // --- History tab (lazy) ---
  const historyQuery = useQuery({
    queryKey: ["sanctioned-strength-history", sanctionedStrengthId],
    queryFn: () => getSanctionedStrengthHistory(sanctionedStrengthId as string),
    enabled: open && activeTab === "history" && Boolean(sanctionedStrengthId),
  });

  // --- Audit Log tab (lazy) ---
  const auditLogQuery = useQuery({
    queryKey: ["audit-logs", "SanctionedStrength", sanctionedStrengthId],
    queryFn: () => listAuditLogs({ entityType: "SanctionedStrength", entityId: sanctionedStrengthId }),
    enabled: open && activeTab === "audit" && Boolean(sanctionedStrengthId) && canViewAuditLog,
  });

  function invalidateAfterSave() {
    void queryClient.invalidateQueries({ queryKey: ["sanctioned-strength-breakdown", departmentId] });
    void queryClient.invalidateQueries({ queryKey: ["sanctioned-strength-register"] });
    onSaved?.();
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createSanctionedStrength({
        campus_id: campusId,
        department_id: departmentId,
        designation_id: designationId as string,
        approved_strength: Number(approvedStrength.trim()),
        effective_from: effectiveFrom,
        remarks: remarks.trim() || null,
        location_id: locationId || null,
      }),
    onSuccess: () => {
      invalidateAfterSave();
      onOpenChange(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to save"),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateSanctionedStrength(sanctionedStrengthId as string, {
        approved_strength: Number(approvedStrength.trim()),
        effective_from: effectiveFrom,
        remarks: remarks.trim() || null,
        location_id: locationId || null,
      }),
    onSuccess: () => {
      invalidateAfterSave();
      onOpenChange(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to save"),
  });

  const trimmedApproved = approvedStrength.trim();
  const isApprovedValid = NON_NEGATIVE_INTEGER.test(trimmedApproved);
  const locationRequired = category === "HOUSEKEEPING";
  const isLocationValid = !locationRequired || Boolean(locationId);
  const canSubmit =
    isApprovedValid && Boolean(effectiveFrom) && isLocationValid && (mode !== "add" || Boolean(designationId));
  const isSaving = createMutation.isPending || updateMutation.isPending;

  function save() {
    if (!canSubmit || !designationId) return;
    setError(null);
    if (sanctionedStrengthId) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  }

  const computedVacancy = Math.max((Number(trimmedApproved) || 0) - working, 0);

  const title = mode === "add" ? "Add sanctioned strength" : mode === "edit" ? "Edit sanctioned strength" : "Sanctioned strength";

  const tabOptions: TabOption<DrawerTab>[] = ALL_TABS.filter((tab) => tab !== "audit" || canViewAuditLog).map(
    (tab) => ({ value: tab, label: TAB_LABELS[tab] }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed inset-y-0 top-0 left-auto right-0 flex h-full w-[26rem] max-w-full translate-x-0 translate-y-0 flex-col gap-4 overflow-hidden rounded-none border-l border-border p-6">
        <DialogHeader>
          <DialogTitle>
            {title}: {resolvedDesignationName}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} tabs={tabOptions} className="flex-wrap" />

        <div className="flex-1 overflow-y-auto">
          {activeTab === "basic" ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <Label>Campus</Label>
                <p className="text-sm text-muted-foreground">{campusLabel}</p>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Department</Label>
                <p className="text-sm text-muted-foreground">{departmentLabel}</p>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="drawer-designation">Designation</Label>
                {mode === "add" ? (
                  <Select value={selectedDesignationId} onValueChange={setSelectedDesignationId}>
                    <SelectTrigger id="drawer-designation" aria-label="Designation">
                      <SelectValue placeholder="Select a designation" />
                    </SelectTrigger>
                    <SelectContent>
                      {candidateDesignations.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          No eligible designations to add.
                        </div>
                      ) : (
                        candidateDesignations.map((designation) => (
                          <SelectItem key={designation.id} value={designation.id}>
                            {designation.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm text-muted-foreground">{resolvedDesignationName}</p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Label>Category</Label>
                <p className="text-sm text-muted-foreground">{category ? category.replace(/_/g, " ") : "—"}</p>
              </div>
            </div>
          ) : null}

          {activeTab === "strength" ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor="drawer-approved">Approved</Label>
                {canManage ? (
                  <Input
                    id="drawer-approved"
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={approvedStrength}
                    aria-invalid={trimmedApproved !== "" && !isApprovedValid}
                    onChange={(e) => setApprovedStrength(e.target.value)}
                  />
                ) : (
                  <p className="text-sm tabular-nums text-muted-foreground">{approvedStrength}</p>
                )}
                {canManage && trimmedApproved !== "" && !isApprovedValid ? (
                  <p className="text-xs text-destructive">Enter a whole number, 0 or more.</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1">
                <Label>Working</Label>
                <p className="text-sm tabular-nums text-muted-foreground">{working}</p>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Vacancy</Label>
                <p className="text-sm tabular-nums text-muted-foreground">{computedVacancy}</p>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="drawer-effective-from">Effective from</Label>
                {canManage ? (
                  <Input
                    id="drawer-effective-from"
                    type="date"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">{effectiveFrom || "—"}</p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="drawer-remarks">Remarks</Label>
                {canManage ? (
                  <Input id="drawer-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                ) : (
                  <p className="text-sm text-muted-foreground">{remarks || "—"}</p>
                )}
              </div>
            </div>
          ) : null}

          {activeTab === "location" ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="drawer-location">Location{locationRequired ? " (required)" : " (optional)"}</Label>
              {canManage ? (
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger id="drawer-location" aria-label="Location">
                    <SelectValue placeholder="Select a location" />
                  </SelectTrigger>
                  <SelectContent>
                    {campusLocations.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No locations on this campus.</div>
                    ) : (
                      campusLocations.map((location) => (
                        <SelectItem key={location.id} value={location.id}>
                          {location.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {breakdownRow?.location_name ?? campusLocations.find((l) => l.id === locationId)?.name ?? "—"}
                </p>
              )}
              {canManage && locationRequired && !locationId ? (
                <p className="text-xs text-destructive">Location is required for Housekeeping.</p>
              ) : null}
            </div>
          ) : null}

          {activeTab === "recruitment" ? (
            !designationId ? (
              <p className="text-sm text-muted-foreground">Pick a designation first.</p>
            ) : availabilityQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : availabilityQuery.isError ? (
              <p className="text-sm text-destructive">
                {availabilityQuery.error instanceof ApiError
                  ? availabilityQuery.error.message
                  : "Failed to load recruitment status."}
              </p>
            ) : availabilityQuery.data ? (
              <div className="flex flex-col gap-3">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Approved</dt>
                    <dd className="tabular-nums">{availabilityQuery.data.approved}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Working</dt>
                    <dd className="tabular-nums">{availabilityQuery.data.working}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Vacant</dt>
                    <dd className="tabular-nums">{availabilityQuery.data.vacant}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Already requested</dt>
                    <dd className="tabular-nums">{availabilityQuery.data.already_requested}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Available to request</dt>
                    <dd className="tabular-nums">{availabilityQuery.data.available_to_request}</dd>
                  </div>
                </dl>
                {availabilityQuery.data.vacant > 0 ? (
                  <Link
                    to={`/vacancy-requests/new?campus=${campusId}&department=${departmentId}&designation=${designationId}&maxCount=${availabilityQuery.data.available_to_request}`}
                    className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Raise vacancy request
                  </Link>
                ) : null}
              </div>
            ) : null
          ) : null}

          {activeTab === "approval" ? (
            !designationId ? (
              <p className="text-sm text-muted-foreground">Pick a designation first.</p>
            ) : vacancyRequestsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : vacancyRequestsQuery.isError ? (
              <p className="text-sm text-destructive">
                {vacancyRequestsQuery.error instanceof ApiError
                  ? vacancyRequestsQuery.error.message
                  : "Failed to load vacancy requests."}
              </p>
            ) : !vacancyRequestsQuery.data || vacancyRequestsQuery.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">No vacancy requests raised for this designation yet.</p>
            ) : (
              <Table>
                <TableHeader className="bg-transparent">
                  <TableRow>
                    <TableHead className="px-0 py-2 text-muted-foreground">Status</TableHead>
                    <TableHead className="px-0 py-2 text-muted-foreground">Created</TableHead>
                    <TableHead className="px-0 py-2 text-muted-foreground">Requested by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vacancyRequestsQuery.data.map((vr) => (
                    <TableRow key={vr.id} className="align-top">
                      <TableCell className="px-0 py-2">
                        <Badge variant="outline">{formatEnumLabel(vr.status)}</Badge>
                      </TableCell>
                      <TableCell className="px-0 py-2 whitespace-nowrap">
                        {new Date(vr.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="px-0 py-2 text-muted-foreground" title={vr.requested_by_id}>
                        {vr.requested_by_id.slice(0, 8)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          ) : null}

          {activeTab === "history" ? (
            !sanctionedStrengthId ? (
              <p className="text-sm text-muted-foreground">{NOT_YET_SANCTIONED_TEXT}</p>
            ) : historyQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : historyQuery.isError ? (
              <p className="text-sm text-destructive">
                {historyQuery.error instanceof ApiError ? historyQuery.error.message : "Failed to load history."}
              </p>
            ) : !historyQuery.data || historyQuery.data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
            ) : (
              <Table>
                <TableHeader className="bg-transparent">
                  <TableRow>
                    <TableHead className="px-0 py-2 text-muted-foreground">When</TableHead>
                    <TableHead className="px-0 py-2 text-muted-foreground">Change</TableHead>
                    <TableHead className="px-0 py-2 text-muted-foreground">Changed by</TableHead>
                    <TableHead className="px-0 py-2 text-muted-foreground">Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyQuery.data.items.map((entry) => (
                    <TableRow key={entry.id} className="align-top">
                      <TableCell className="px-0 py-2 whitespace-nowrap">
                        {new Date(entry.changed_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="px-0 py-2 tabular-nums">
                        {entry.old_value ?? "—"} → {entry.new_value}
                      </TableCell>
                      <TableCell className="px-0 py-2 text-muted-foreground" title={entry.changed_by_id}>
                        {entry.changed_by_id.slice(0, 8)}
                      </TableCell>
                      <TableCell className="px-0 py-2 text-muted-foreground">{sourceLabel(entry.source)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          ) : null}

          {activeTab === "audit" ? (
            !sanctionedStrengthId ? (
              <p className="text-sm text-muted-foreground">{NOT_YET_SANCTIONED_TEXT}</p>
            ) : auditLogQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : auditLogQuery.isError ? (
              <p className="text-sm text-destructive">
                {auditLogQuery.error instanceof ApiError ? auditLogQuery.error.message : "Failed to load the audit log."}
              </p>
            ) : !auditLogQuery.data || auditLogQuery.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">No audit log entries recorded yet.</p>
            ) : (
              <Table>
                <TableHeader className="bg-transparent">
                  <TableRow>
                    <TableHead className="px-0 py-2 text-muted-foreground">When</TableHead>
                    <TableHead className="px-0 py-2 text-muted-foreground">Action</TableHead>
                    <TableHead className="px-0 py-2 text-muted-foreground">Actor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLogQuery.data.map((entry: AuditLogRead) => (
                    <TableRow key={entry.id} className="align-top">
                      <TableCell className="px-0 py-2 whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="px-0 py-2">{entry.action}</TableCell>
                      <TableCell className="px-0 py-2 text-muted-foreground" title={entry.actor_user_id ?? undefined}>
                        {entry.actor_user_id ? entry.actor_user_id.slice(0, 8) : "System"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          ) : null}
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {canManage && ["basic", "strength", "location"].includes(activeTab) ? (
          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={!canSubmit || isSaving}>
              {isSaving ? "Saving…" : mode === "add" ? "Add" : "Save"}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
