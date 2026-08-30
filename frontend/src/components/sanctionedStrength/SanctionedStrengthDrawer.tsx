import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
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
import type { AuditLogRead, StaffRoleCategory, TeachingStrengthRow } from "@/api/types";
import { listVacancyRequests } from "@/api/vacancyRequests";
import { CategoryBadge } from "@/components/domain/CategoryBadge";
import { STATUS_DISPLAY } from "@/components/sanctionedStrength/TeachingStrengthTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, type TabOption } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

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

// Redesigned 2026-08-29 from a 26rem right-side drawer into a centred modal.
// The five editable/among-the-form tabs (Basic Info / Strength / Location /
// Recruitment Status / Approval Status) collapse into ONE "Details" tab laid
// out as four cards, because the brief's core complaint was that the values a
// user opens this for were spread across tabs in a panel too narrow to hold
// them. History and Audit Log stay as separate READ-ONLY tabs -- deliberately
// not folded into the form, per the brief.
type DrawerTab = "details" | "history" | "audit";

const TAB_LABELS: Record<DrawerTab, string> = {
  details: "Details",
  history: "History",
  audit: "Audit Log",
};

const ALL_TABS: DrawerTab[] = ["details", "history", "audit"];

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

/** One titled card in the Details tab. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <h3 className="mb-3 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** Read-only label/value pair. Dark, high-contrast value text per the brief --
 * these are values people come here to read, not secondary chrome. */
function ReadField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm font-medium break-words text-foreground">{value ?? "--"}</span>
    </div>
  );
}

// Semantic tones for the four headline numbers, following the brief: green
// for healthy, orange for a vacancy needing recruitment, blue for a neutral
// figure. Red is reserved for the genuinely critical case (everything vacant).
const METRIC_TONES = {
  neutral: "border-border bg-muted/40 text-foreground",
  blue: "border-brand-info/30 bg-brand-info/10 text-brand-info",
  green: "border-brand-success/30 bg-brand-success/10 text-brand-success",
  orange: "border-brand-warning/30 bg-brand-warning/10 text-brand-warning",
  red: "border-destructive/30 bg-destructive/10 text-destructive",
} as const;

/** A prominent numeric tile -- the brief asks for the numbers to carry visual
 * weight rather than sit as small grey text like they did in the drawer. */
function Metric({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: keyof typeof METRIC_TONES;
  hint?: string;
}) {
  return (
    <div className={cn("rounded-lg border px-3 py-2.5", METRIC_TONES[tone])}>
      <p className="text-[11px] font-semibold tracking-wide uppercase opacity-80">{label}</p>
      <p className="mt-0.5 text-2xl leading-tight font-bold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] opacity-75">{hint}</p> : null}
    </div>
  );
}

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
  /** The Teaching/Non-Teaching view row this modal was opened from, when
   * there is one. Supplies status / filled_pct / last_join / last_resignation
   * / last_updated, none of which the breakdown endpoint returns -- so the
   * Strength and Record Info sections degrade to "--" rather than lying when
   * this is absent (SanctionedStrengthPage's own call site has no view row).
   * Read-only display data: nothing here is ever sent back on save. */
  viewRow?: Pick<
    TeachingStrengthRow,
    "filled_pct" | "status" | "last_join" | "last_resignation" | "last_updated" | "location_name"
  > | null;
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
  viewRow,
  onSaved,
}: SanctionedStrengthDrawerProps) {
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<DrawerTab>("details");
  // Guards the "you have unsaved changes" confirmation. `baseline` is the
  // seeded server state; the form is dirty when any editable field differs.
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [baseline, setBaseline] = useState({
    approvedStrength: "0",
    workingOverride: "",
    effectiveFrom: "",
    remarks: "",
    locationId: "",
  });
  const [selectedDesignationId, setSelectedDesignationId] = useState("");
  const [approvedStrength, setApprovedStrength] = useState("0");
  // "" means "no override -- use the live roster count", matching the
  // backend's NULL. Kept as a string, like approvedStrength, so a
  // half-typed value round-trips through the input without being coerced.
  const [workingOverride, setWorkingOverride] = useState("");
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
    setActiveTab(canManage ? "details" : "history");
    setConfirmCloseOpen(false);
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

  // `breakdownRow.working` is the RESOLVED figure -- the manual override when
  // the row has one, the live roster count otherwise. So the live count is
  // recoverable here only when no override is set. That is the common case
  // (and the only case for every row predating the feature), but while
  // editing a row that already carries an override the live count is
  // genuinely unknown client-side: the server does not send both. Rather
  // than invent a number, `liveWorking` is null there and the Working tile
  // reads "--" until the clear is saved. Fetching it would cost a second
  // field on every breakdown row to serve one transient editing state.
  const serverWorkingOverride = breakdownRow?.working_override ?? null;
  const liveWorking = serverWorkingOverride === null ? (breakdownRow?.working ?? 0) : null;

  // Re-seed the form fields once the breakdown resolves (or immediately, to
  // blank defaults, for Add mode before a designation is chosen) -- separate
  // from the tab/selection reset above since this depends on an async fetch.
  useEffect(() => {
    if (!open) return;
    if (mode === "add" && !designationId) {
      setApprovedStrength("0");
      setWorkingOverride("");
      setEffectiveFrom(todayIsoDate());
      setRemarks("");
      setLocationId("");
      setBaseline({
        approvedStrength: "0",
        workingOverride: "",
        effectiveFrom: todayIsoDate(),
        remarks: "",
        locationId: "",
      });
      return;
    }
    if (!breakdownQuery.isSuccess) return;
    const row = breakdownQuery.data.find((candidate) => candidate.designation_id === designationId);
    const seeded = {
      approvedStrength: String(row?.approved ?? 0),
      // Seeded from the RAW override, never from the resolved `working` --
      // pre-filling the box with a live roster count would silently convert
      // it into a manual override on the next save.
      workingOverride: row?.working_override === null || row?.working_override === undefined ? "" : String(row.working_override),
      effectiveFrom: row?.effective_from ?? todayIsoDate(),
      remarks: row?.remarks ?? "",
      locationId: row?.location_id ?? "",
    };
    setApprovedStrength(seeded.approvedStrength);
    setWorkingOverride(seeded.workingOverride);
    setEffectiveFrom(seeded.effectiveFrom);
    setRemarks(seeded.remarks);
    setLocationId(seeded.locationId);
    setBaseline(seeded);
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
    // Both of these used to be gated on their own tab. Those tabs are gone
    // (folded into Details), and the brief explicitly wants these values
    // visible without extra clicks -- so they now load with the Details tab,
    // which costs two requests on open. That is the deliberate trade for not
    // hiding recruitment/approval state behind a click.
    enabled: open && activeTab === "details" && Boolean(designationId),
  });

  // --- Approval Status tab (lazy) ---
  const vacancyRequestsQuery = useQuery({
    queryKey: ["vacancy-requests-by-designation", departmentId, designationId],
    queryFn: () => listVacancyRequests(null, { departmentId, designationId }),
    enabled: open && activeTab === "details" && Boolean(designationId),
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

  // --- Working override, derived once and used by the payload, the tiles and
  // the dirty check, so none of the three can disagree. ---
  const trimmedOverride = workingOverride.trim();
  // Blank is legal (it IS the "no override" value); anything else must be a
  // whole number, same rule as Approved.
  const isOverrideValid = trimmedOverride === "" || NON_NEGATIVE_INTEGER.test(trimmedOverride);
  const hasOverrideTyped = trimmedOverride !== "" && NON_NEGATIVE_INTEGER.test(trimmedOverride);
  const overridePayloadValue = hasOverrideTyped ? Number(trimmedOverride) : null;
  // The figure every derived number below is computed from. null means "not
  // knowable client-side right now" -- only reachable while clearing an
  // override that the server still holds (see `liveWorking`).
  const effectiveWorking: number | null = hasOverrideTyped ? Number(trimmedOverride) : liveWorking;

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
        working_override: overridePayloadValue,
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
        // Always sent, null included -- the backend keys this field off the
        // key's PRESENCE, so an explicit null is what clears an override.
        // Omitting it would make "clear this" a silent no-op.
        working_override: overridePayloadValue,
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
    isApprovedValid &&
    isOverrideValid &&
    Boolean(effectiveFrom) &&
    isLocationValid &&
    (mode !== "add" || Boolean(designationId));
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

  // Both headline figures now track whatever Working currently resolves to,
  // so typing an override moves Vacancy and Filled % with it -- the same way
  // typing an Approved value already did. null when Working itself is
  // unknown, rendered "--" rather than guessing at 0.
  const computedVacancy =
    effectiveWorking === null ? null : Math.max((Number(trimmedApproved) || 0) - effectiveWorking, 0);

  // Live filled % against the value currently typed, so the figure agrees
  // with the Vacancy line above it while editing. Falls back to the view
  // row's own server-computed filled_pct when Approved is blank/invalid, and
  // is null (rendered "--") when approved is 0 -- same convention as the
  // backend, which sends null rather than 0.0 in that case.
  const approvedNumber = Number(trimmedApproved);
  const filledPct =
    isApprovedValid && approvedNumber > 0 && effectiveWorking !== null
      ? Math.round((effectiveWorking / approvedNumber) * 100)
      : (viewRow?.filled_pct ?? null);

  const isDirty =
    approvedStrength !== baseline.approvedStrength ||
    workingOverride !== baseline.workingOverride ||
    effectiveFrom !== baseline.effectiveFrom ||
    remarks !== baseline.remarks ||
    locationId !== baseline.locationId;

  // Intercepts every close path Radix routes through onOpenChange -- the X,
  // Escape and an overlay click -- so none of them can silently discard an
  // edit. Saving closes via onOpenChange(false) from the mutation's own
  // onSuccess, by which point the form is no longer dirty.
  function handleOpenChange(next: boolean) {
    if (!next && canManage && isDirty && !isSaving) {
      setConfirmCloseOpen(true);
      return;
    }
    onOpenChange(next);
  }

  function discardAndClose() {
    setConfirmCloseOpen(false);
    onOpenChange(false);
  }

  const title = mode === "add" ? "Add Sanctioned Strength" : mode === "edit" ? "Edit Sanctioned Strength" : "Sanctioned Strength";

  const statusDisplay = viewRow ? STATUS_DISPLAY[viewRow.status] : null;
  const isActiveRecord = viewRow ? viewRow.status !== "INACTIVE" : null;

  function formatDate(value: string | null | undefined): string {
    if (!value) return "--";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
  }

  const tabOptions: TabOption<DrawerTab>[] = ALL_TABS.filter((tab) => tab !== "audit" || canViewAuditLog).map(
    (tab) => ({ value: tab, label: TAB_LABELS[tab] }),
  );

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        {/* Centred modal, 850-1000px per the brief (60rem = 960px), capped at
            95vw/90vh so it stays usable on a laptop and on a tablet. Replaces
            the old `fixed inset-y-0 right-0 w-[26rem]` right-side panel, whose
            width was the root cause of the wrapped tabs and hidden fields. */}
        <DialogContent className="flex max-h-[90vh] w-full max-w-[min(60rem,95vw)] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 space-y-0 border-b border-border px-6 py-4 text-left">
            <DialogTitle className="text-sm font-semibold text-muted-foreground">{title}</DialogTitle>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="font-display text-xl leading-tight font-bold text-foreground">
                {resolvedDesignationName}
              </span>
              {category ? <CategoryBadge category={category} /> : null}
              {statusDisplay ? <Badge variant={statusDisplay.variant}>{statusDisplay.label}</Badge> : null}
              {isActiveRecord === null ? null : (
                <Badge variant={isActiveRecord ? "success" : "destructive"}>
                  {isActiveRecord ? "Active" : "Inactive"}
                </Badge>
              )}
            </div>
          </DialogHeader>

          <div className="shrink-0 border-b border-border px-6 py-3">
            <Tabs value={activeTab} onValueChange={setActiveTab} tabs={tabOptions} />
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {activeTab === "details" ? (
              <div className="flex flex-col gap-4">
                {/* ---------- 1. POSITION ---------- */}
                <Section title="Position">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <ReadField label="Campus" value={campusLabel} />
                    <ReadField label="Department" value={departmentLabel} />
                    <div className="flex min-w-0 flex-col gap-1">
                      <Label htmlFor="drawer-designation" className="text-xs font-medium text-muted-foreground">
                        Designation
                      </Label>
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
                        <span className="text-sm font-medium text-foreground">{resolvedDesignationName}</span>
                      )}
                    </div>
                    <ReadField label="Category" value={category ? category.replace(/_/g, " ") : "--"} />
                    <div className="flex min-w-0 flex-col gap-1 sm:col-span-2 lg:col-span-1">
                      <Label htmlFor="drawer-location" className="text-xs font-medium text-muted-foreground">
                        Location{locationRequired ? " (required)" : " (optional)"}
                      </Label>
                      {canManage ? (
                        <Select value={locationId} onValueChange={setLocationId}>
                          <SelectTrigger id="drawer-location" aria-label="Location">
                            <SelectValue placeholder="Select a location" />
                          </SelectTrigger>
                          <SelectContent>
                            {campusLocations.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-muted-foreground">
                                No locations on this campus.
                              </div>
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
                        <span className="text-sm font-medium text-foreground">
                          {breakdownRow?.location_name ??
                            viewRow?.location_name ??
                            campusLocations.find((l) => l.id === locationId)?.name ??
                            "--"}
                        </span>
                      )}
                      {canManage && locationRequired && !locationId ? (
                        <p className="text-xs text-destructive">Location is required for Housekeeping.</p>
                      ) : null}
                    </div>
                  </div>
                </Section>

                {/* ---------- 2. STRENGTH ---------- */}
                <Section title="Strength">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="flex min-w-0 flex-col gap-1">
                      <Label htmlFor="drawer-approved" className="text-xs font-medium text-muted-foreground">
                        Approved / Sanctioned
                      </Label>
                      {canManage ? (
                        <Input
                          id="drawer-approved"
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          className="h-11 text-lg font-semibold tabular-nums"
                          value={approvedStrength}
                          aria-invalid={trimmedApproved !== "" && !isApprovedValid}
                          onChange={(e) => setApprovedStrength(e.target.value)}
                        />
                      ) : (
                        <span className="text-2xl font-bold tabular-nums text-foreground">{approvedStrength}</span>
                      )}
                      {canManage && trimmedApproved !== "" && !isApprovedValid ? (
                        <p className="text-xs text-destructive">Enter a whole number, 0 or more.</p>
                      ) : null}
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <Label htmlFor="drawer-working" className="text-xs font-medium text-muted-foreground">
                        Working
                      </Label>
                      {canManage ? (
                        <Input
                          id="drawer-working"
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          placeholder={liveWorking === null ? "" : String(liveWorking)}
                          className="h-11 text-lg font-semibold tabular-nums"
                          value={workingOverride}
                          aria-invalid={!isOverrideValid}
                          onChange={(e) => setWorkingOverride(e.target.value)}
                        />
                      ) : (
                        <span className="text-2xl font-bold tabular-nums text-foreground">
                          {effectiveWorking ?? "--"}
                        </span>
                      )}
                      {canManage && !isOverrideValid ? (
                        <p className="text-xs text-destructive">Enter a whole number, 0 or more.</p>
                      ) : canManage ? (
                        // The one thing a user cannot see from the number
                        // itself: whether it was typed or counted. Clearing
                        // the box is a real action (it hands the row back to
                        // the roster), so it needs saying out loud.
                        <p className="text-[11px] text-muted-foreground">
                          {hasOverrideTyped
                            ? "Entered manually. Clear this box to use the live staff count instead."
                            : liveWorking === null
                              ? "Cleared — the live staff count applies once you save."
                              : `Live staff count (${liveWorking}). Type a number to override it.`}
                        </p>
                      ) : null}
                    </div>
                    <Metric
                      label="Vacancy"
                      value={computedVacancy ?? "--"}
                      tone={computedVacancy === null ? "neutral" : computedVacancy === 0 ? "green" : "orange"}
                      hint={
                        computedVacancy === null
                          ? undefined
                          : `${trimmedApproved || 0} approved - ${effectiveWorking} working`
                      }
                    />
                    <Metric
                      label="Filled %"
                      value={filledPct === null ? "--" : `${filledPct}%`}
                      tone={
                        filledPct === null ? "neutral" : filledPct >= 100 ? "green" : filledPct === 0 ? "red" : "orange"
                      }
                    />
                  </div>

                  {/* The calculation stated in words, per the brief. Display
                      only: `computedVacancy` is unchanged, still floored at 0,
                      and the server stays authoritative. */}
                  <p className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">Vacancy = Approved - Working</span>
                    {" — "}
                    {computedVacancy === null ? (
                      <>
                        {trimmedApproved || 0} - (live staff count) . Save to see the figure.
                      </>
                    ) : (
                      <>
                        {trimmedApproved || 0} - {effectiveWorking} = {computedVacancy}. Recruitment is required while
                        this is above zero.
                      </>
                    )}
                  </p>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="flex min-w-0 flex-col gap-1">
                      <Label htmlFor="drawer-effective-from" className="text-xs font-medium text-muted-foreground">
                        Effective from
                      </Label>
                      {canManage ? (
                        <Input
                          id="drawer-effective-from"
                          type="date"
                          value={effectiveFrom}
                          onChange={(e) => setEffectiveFrom(e.target.value)}
                        />
                      ) : (
                        <span className="text-sm font-medium text-foreground">{effectiveFrom || "--"}</span>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <Label htmlFor="drawer-remarks" className="text-xs font-medium text-muted-foreground">
                        Remarks
                      </Label>
                      {canManage ? (
                        <Input id="drawer-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                      ) : (
                        <span className="text-sm font-medium text-foreground">{remarks || "--"}</span>
                      )}
                    </div>
                  </div>
                </Section>

                {/* ---------- 3. RECRUITMENT ---------- */}
                <Section title="Recruitment">
                  <div className="grid gap-5 lg:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <p className="text-xs font-semibold text-foreground">Recruitment status</p>
                      {!designationId ? (
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
                          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                            <div>
                              <dt className="text-xs text-muted-foreground">Approved</dt>
                              <dd className="font-medium tabular-nums text-foreground">
                                {availabilityQuery.data.approved}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs text-muted-foreground">Working</dt>
                              <dd className="font-medium tabular-nums text-foreground">
                                {availabilityQuery.data.working}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs text-muted-foreground">Vacant</dt>
                              <dd className="font-medium tabular-nums text-foreground">
                                {availabilityQuery.data.vacant}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs text-muted-foreground">Already requested</dt>
                              <dd className="font-medium tabular-nums text-foreground">
                                {availabilityQuery.data.already_requested}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs text-muted-foreground">Available to request</dt>
                              <dd className="font-medium tabular-nums text-foreground">
                                {availabilityQuery.data.available_to_request}
                              </dd>
                            </div>
                          </dl>
                          {availabilityQuery.data.vacant > 0 ? (
                            <Link
                              to={`/vacancy-requests/new?campus=${campusId}&department=${departmentId}&designation=${designationId}&maxCount=${availabilityQuery.data.available_to_request}`}
                              className="w-fit rounded-md border border-brand-primary/40 px-3 py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-accent"
                            >
                              Raise vacancy request
                            </Link>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-col gap-2">
                      <p className="text-xs font-semibold text-foreground">Approval status / vacancy requests</p>
                      {!designationId ? (
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
                        <p className="text-sm text-muted-foreground">
                          No vacancy requests raised for this designation yet.
                        </p>
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
                      )}
                    </div>
                  </div>
                </Section>

                {/* ---------- 4. RECORD INFO ---------- */}
                <Section title="Record info">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <ReadField label="Last join" value={formatDate(viewRow?.last_join)} />
                    <ReadField label="Last resignation" value={formatDate(viewRow?.last_resignation)} />
                    <ReadField label="Last updated" value={formatDate(viewRow?.last_updated)} />
                    {/* "Updated by" is in the brief but no endpoint exposes it:
                        SanctionedStrength has an updated_by_id column, yet
                        neither the view rows nor the breakdown return it, and
                        surfacing it would need the backend change this task
                        excludes. History and Audit Log both name who changed
                        what, so the information is reachable -- it just is not
                        available as a field here. */}
                    <ReadField
                      label="Updated by"
                      value={<span className="text-muted-foreground">See History tab</span>}
                    />
                  </div>
                </Section>
              </div>
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
                  {auditLogQuery.error instanceof ApiError
                    ? auditLogQuery.error.message
                    : "Failed to load the audit log."}
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

          {error ? (
            <p
              role="alert"
              className="shrink-0 border-t border-destructive/30 bg-destructive/10 px-6 py-2.5 text-sm font-medium text-destructive"
            >
              {error}
            </p>
          ) : null}

          {/* Sticky footer -- outside the scroll area, so Save stays reachable
              however long the Details tab gets. */}
          {canManage && activeTab === "details" ? (
            <DialogFooter className="shrink-0 border-t border-border bg-card px-6 py-3">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="button" onClick={save} disabled={!canSubmit || isSaving} isLoading={isSaving}>
                {isSaving ? "Saving…" : mode === "add" ? "Add" : "Save Changes"}
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Unsaved-changes guard. A sibling Dialog rather than one nested inside
          the modal above, so it is unaffected by that dialog closing. */}
      <Dialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This record has edits that have not been saved. Closing now will lose them.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmCloseOpen(false)}>
              Keep editing
            </Button>
            <Button type="button" variant="destructive" onClick={discardAndClose}>
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
