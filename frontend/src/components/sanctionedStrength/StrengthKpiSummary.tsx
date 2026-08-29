import { AlertTriangle, CheckCircle2, ClipboardCheck, LayoutList, UserPlus, Users } from "lucide-react";

import { StatTile, type StatAccent, type StatIconColor } from "@/components/dashboard/StatTile";

// KPI summary row for the 3 Sanctioned Strength "operational view" tables
// (TeachingStrengthTable/NonTeachingStrengthTable/HousekeepingStrengthTable)
// -- a live UI-consistency gap found post-Phase-I: the Phase I dashboard tile
// (DashboardPage.tsx's own sanctioned_approved_total/sanctioned_working_total/
// sanctioned_vacancy_total KPI cards) summarizes Sanctioned Strength
// page-wide, but none of these 3 dedicated views showed any summary of their
// *own*, currently-filtered scope above their own table -- inconsistent with
// every other HRMS-style module in this codebase. Reuses `StatTile` directly
// (Phase I's own dashboard tile component) rather than a new visual shape --
// same Card/label/value/accent/zeroCaption/tooltip contract, just rendered in
// a 6-tile row scoped to one table instead of DashboardPage's own 9-tile
// strip, and fed from each table's own already-fetched query response
// (`approved_total`/`working_total`/`vacancy_total` for Teaching/Non-Teaching,
// `required_total`/`available_total`/`vacancy_total` for Housekeeping --
// see api/types.ts's own docstrings on those 3 response interfaces) rather
// than a second network call.
//
// Deliberately does NOT wire into SanctionedStrengthPage.tsx's own legacy
// "All" rollup table (DesignationRow/register-based) or the Upload history
// tab -- neither's underlying response carries these per-category totals,
// and inventing a new aggregation for that legacy path is out of scope for
// this fix-forward (glowing-zooming-hamming.md Phase K).
//
// Total Records / Fully Staffed / Recruitment Required are read straight off
// each view's existing `status_counts` dict (`.ALL`/`.FULLY_STAFFED`/
// `.VACANCY_RECRUITMENT_REQUIRED`) -- already a snapshot across every active
// filter except `status` itself, the exact same point-in-time the 3 new
// *_total fields are snapshotted at, so all 6 tiles agree with each other
// even while a Status filter is applied.

// Enterprise-HRMS colour pass (2026-08-29): each tile gains an icon chip in
// its own semantic tone, and "Vacancies" is promoted to the strip's single
// `hero` tile. Purely presentational -- every value, tooltip, zeroCaption and
// the signed-vacancy accent logic below are untouched, so nothing about what
// these tiles *count* changes. Tones follow this app's fixed colour spec
// (index.css): blue = neutral figure, purple = analytics/sanctioned,
// green = healthy, orange = needs attention, red = urgent.
//
// "Vacancies" is the one tile a user opens this page to read, so it carries
// `hero` (the signature gradient ring) -- StatTile's own contract reserves
// that for exactly ONE tile per strip, which is why no other tile here sets
// it. `hero` deliberately suppresses the left accent stripe (see StatTile),
// so the sign-based `vacancyAccent` below now drives only the ICON tone,
// keeping "negative = overstaffed reads differently from positive = short-
// staffed" legible without a competing border treatment.
export type StrengthKpiSummaryVariant = "APPROVED_WORKING" | "REQUIRED_AVAILABLE";

export interface StrengthKpiSummaryProps {
  /** "APPROVED_WORKING" for Teaching/Non-Teaching (labels "Approved"/
   * "Working", fed from `approved_total`/`working_total`) -- "REQUIRED_AVAILABLE"
   * for Housekeeping (labels "Required"/"Available", fed from
   * `required_total`/`available_total`) -- mirrors the same field rename
   * `HousekeepingStrengthRow` itself already carries (api/types.ts's own
   * docstring: no single sanctioned_strength_id per row at Housekeeping's
   * Location grain, so this view uses its own vocabulary throughout). */
  variant: StrengthKpiSummaryVariant;
  totalRecords: number | undefined;
  approvedOrRequired: number | undefined;
  workingOrAvailable: number | undefined;
  /** Deliberately signed, not floored -- can read negative (net overstaffed
   * across the current filtered scope). See `vacancyAccent` below for how
   * that's made to read as meaningful rather than a rendering glitch, same
   * sign-color-coding decision as DashboardPage.tsx's own
   * sanctioned_vacancy_total tile. */
  vacancyTotal: number | undefined;
  fullyStaffed: number | undefined;
  recruitmentRequired: number | undefined;
  isLoading: boolean;
}

/** Same sign-based accent decision as DashboardPage.tsx's own `vacancyAccent`
 * for sanctioned_vacancy_total -- the one KPI on this strip that can
 * legitimately go negative. Kept as a local copy rather than an import: it's
 * a 5-line pure function with no shared state, and DashboardPage.tsx doesn't
 * export it (matches this codebase's existing precedent of small
 * self-contained per-component display helpers over a shared cross-file
 * utility for something this size -- see e.g. Teaching/Non-Teaching/
 * Housekeeping's own STATUS_DISPLAY constants). */
function vacancyAccent(value: number | undefined): StatAccent {
  if (typeof value !== "number") return "gold";
  if (value < 0) return "orange";
  if (value === 0) return "green";
  return "gold";
}

/** Icon-chip tone counterpart to `vacancyAccent` -- same sign semantics
 * (negative = net overstaffed, zero = balanced, positive = short-staffed),
 * expressed in StatIconColor's vocabulary rather than StatAccent's. Kept
 * separate because the two palettes genuinely differ: StatAccent has no
 * "purple", StatIconColor has no "gold". */
function vacancyIconColor(value: number | undefined): StatIconColor {
  if (typeof value !== "number") return "orange";
  if (value < 0) return "purple";
  if (value === 0) return "green";
  return "red";
}

export function StrengthKpiSummary({
  variant,
  totalRecords,
  approvedOrRequired,
  workingOrAvailable,
  vacancyTotal,
  fullyStaffed,
  recruitmentRequired,
  isLoading,
}: StrengthKpiSummaryProps) {
  const approvedOrRequiredLabel = variant === "APPROVED_WORKING" ? "Approved" : "Required";
  const workingOrAvailableLabel = variant === "APPROVED_WORKING" ? "Working" : "Available";
  const approvedOrRequiredTooltip =
    variant === "APPROVED_WORKING"
      ? "Sum of approved sanctioned strength across every row in this view, respecting every active filter except Status."
      : "Sum of required sanctioned strength (SUM of approved_strength per location) across every row in this view, respecting every active filter except Status.";
  const workingOrAvailableTooltip =
    variant === "APPROVED_WORKING"
      ? "Live headcount currently working against those same rows, across every active filter except Status."
      : "Live count of active HousekeepingStaff across those same rows, across every active filter except Status.";

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <StatTile
        label="Total Records"
        value={totalRecords}
        isLoading={isLoading}
        accent="blue"
        icon={LayoutList}
        iconColor="blue"
        tooltip="Every row currently in this view (status_counts.ALL) -- respects every active filter except Status, before pagination."
      />
      <StatTile
        label={approvedOrRequiredLabel}
        value={approvedOrRequired}
        isLoading={isLoading}
        accent="gold"
        icon={ClipboardCheck}
        iconColor="purple"
        tooltip={approvedOrRequiredTooltip}
      />
      <StatTile
        label={workingOrAvailableLabel}
        value={workingOrAvailable}
        isLoading={isLoading}
        accent="green"
        icon={Users}
        iconColor="green"
        tooltip={workingOrAvailableTooltip}
        zeroCaption="No staff currently working against sanctioned strength in this view"
      />
      <StatTile
        label="Vacancies"
        value={vacancyTotal}
        isLoading={isLoading}
        accent={vacancyAccent(vacancyTotal)}
        hero
        icon={AlertTriangle}
        iconColor={vacancyIconColor(vacancyTotal)}
        tooltip="Signed net vacancy across every row in this view -- NOT the sum of each row's vacancy floored at 0. Negative means net overstaffed in this view, not 'no vacancy'."
        zeroCaption="Fully staffed -- no net vacancy or overstaffing in this view"
      />
      <StatTile
        label="Fully Staffed"
        value={fullyStaffed}
        isLoading={isLoading}
        accent="green"
        icon={CheckCircle2}
        iconColor="green"
        tooltip="Rows with a Fully Staffed status in this view (status_counts.FULLY_STAFFED)."
      />
      <StatTile
        label="Recruitment Required"
        value={recruitmentRequired}
        isLoading={isLoading}
        accent="orange"
        icon={UserPlus}
        iconColor="orange"
        tooltip="Rows with a Vacancy/Recruitment Required status in this view (status_counts.VACANCY_RECRUITMENT_REQUIRED)."
      />
    </div>
  );
}
