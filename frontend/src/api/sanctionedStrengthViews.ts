import { apiFetch } from "@/api/client";
import type { SortDirection } from "@/api/sanctionedStrength";
import type {
  HousekeepingStrengthListResponse,
  HousekeepingStrengthStatus,
  NonTeachingStrengthListResponse,
  NonTeachingStrengthStatus,
  TeachingStrengthListResponse,
  TeachingStrengthStatus,
} from "@/api/types";

// New sibling module to api/sanctionedStrength.ts (glowing-zooming-hamming.md
// Phase E) -- deliberately a separate file rather than an addition to
// sanctionedStrength.ts, mirroring the backend's own split
// (app/services/sanctioned_strength_views.py sits alongside, not inside,
// app/services/sanctioned_strength.py -- see that module's docstring for the
// "different grain, sibling file" reasoning). sanctionedStrength.ts already
// covers the department-level register, its CRUD/history, and bulk upload;
// this file is the one place for the new designation-level operational
// *views* (Teaching now, Non-Teaching/Housekeeping in Phases F/G), keeping
// each concern in its own file per this codebase's "one file per concern"
// convention (see CLAUDE.md's Repo layout section). `SortDirection` is
// imported from sanctionedStrength.ts rather than redeclared here -- both
// modules' sort params are the same "asc"/"desc" shape, so importing keeps
// one source of truth instead of two identical literal-union types drifting
// apart.

export type TeachingStrengthSortBy =
  | "campus_code"
  | "department_name"
  | "designation_name"
  | "location_name"
  | "approved"
  | "working"
  | "vacancy"
  | "filled_pct"
  | "status"
  | "last_join"
  | "last_resignation"
  | "last_updated";

export interface ListTeachingStrengthParams {
  limit?: number;
  offset?: number;
  sort_by?: TeachingStrengthSortBy;
  sort_dir?: SortDirection;
  campus_code?: string | null;
  department_id?: string | null;
  designation_id?: string | null;
  location_id?: string | null;
  search?: string | null;
  status?: TeachingStrengthStatus | null;
  // Exact-match filter (not a floor/ceiling range) -- mirrors the backend's
  // own `vacancy: int | None` query param, which the service layer applies
  // as `row["vacancy"] == vacancy` (see
  // app/services/sanctioned_strength_views.py::list_teaching_strength_rows).
  vacancy?: number | null;
}

// Mirrors GET /sanctioned-strength/views/teaching
// (app/api/v1/routers/sanctioned_strength.py) -- returns the *full* response
// (not unwrapped to .items), same convention as
// listSanctionedStrengthRegister(): the Teaching table needs `total` for
// real server-side pagination and `status_counts` for a status-tabs-style
// filter UI, not a fetch-everything-unfiltered list.
export async function listTeachingStrengthRows(
  params: ListTeachingStrengthParams = {},
): Promise<TeachingStrengthListResponse> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  if (params.sort_by) query.set("sort_by", params.sort_by);
  if (params.sort_dir) query.set("sort_dir", params.sort_dir);
  if (params.campus_code) query.set("campus_code", params.campus_code);
  if (params.department_id) query.set("department_id", params.department_id);
  if (params.designation_id) query.set("designation_id", params.designation_id);
  if (params.location_id) query.set("location_id", params.location_id);
  if (params.search) query.set("search", params.search);
  if (params.status) query.set("status", params.status);
  if (params.vacancy !== undefined && params.vacancy !== null) {
    query.set("vacancy", String(params.vacancy));
  }

  const qs = query.toString();
  return apiFetch<TeachingStrengthListResponse>(`/sanctioned-strength/views/teaching${qs ? `?${qs}` : ""}`);
}

// Non-Teaching sibling of TeachingStrengthSortBy/ListTeachingStrengthParams/
// listTeachingStrengthRows above (glowing-zooming-hamming.md Phase F) --
// GET /sanctioned-strength/views/non-teaching has the identical param set
// (see app/api/v1/routers/sanctioned_strength.py::list_non_teaching_strength_view,
// which validates sort_by/sort_dir/status against the exact same
// TEACHING_STRENGTH_SORT_FIELDS/_SORT_DIRECTIONS/_STATUS_VALUES tuples the
// Teaching endpoint uses -- see app/services/sanctioned_strength_views.py's
// own docstring for why those constant names are reused, not duplicated,
// server-side). Duplicated here (not a shared `type StrengthSortBy = ...`)
// for the same reason the two row schemas stay distinct types in
// api/types.ts -- a future divergence between the two views shouldn't force
// an awkward shared-type edit.
export type NonTeachingStrengthSortBy =
  | "campus_code"
  | "department_name"
  | "designation_name"
  | "location_name"
  | "approved"
  | "working"
  | "vacancy"
  | "filled_pct"
  | "status"
  | "last_join"
  | "last_resignation"
  | "last_updated";

export interface ListNonTeachingStrengthParams {
  limit?: number;
  offset?: number;
  sort_by?: NonTeachingStrengthSortBy;
  sort_dir?: SortDirection;
  campus_code?: string | null;
  department_id?: string | null;
  designation_id?: string | null;
  location_id?: string | null;
  search?: string | null;
  status?: NonTeachingStrengthStatus | null;
  vacancy?: number | null;
}

// Mirrors GET /sanctioned-strength/views/non-teaching -- returns the full
// response (not unwrapped to .items), same convention as
// listTeachingStrengthRows() just above.
export async function listNonTeachingStrengthRows(
  params: ListNonTeachingStrengthParams = {},
): Promise<NonTeachingStrengthListResponse> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  if (params.sort_by) query.set("sort_by", params.sort_by);
  if (params.sort_dir) query.set("sort_dir", params.sort_dir);
  if (params.campus_code) query.set("campus_code", params.campus_code);
  if (params.department_id) query.set("department_id", params.department_id);
  if (params.designation_id) query.set("designation_id", params.designation_id);
  if (params.location_id) query.set("location_id", params.location_id);
  if (params.search) query.set("search", params.search);
  if (params.status) query.set("status", params.status);
  if (params.vacancy !== undefined && params.vacancy !== null) {
    query.set("vacancy", String(params.vacancy));
  }

  const qs = query.toString();
  return apiFetch<NonTeachingStrengthListResponse>(`/sanctioned-strength/views/non-teaching${qs ? `?${qs}` : ""}`);
}

// Housekeeping sibling of TeachingStrengthSortBy/NonTeachingStrengthSortBy
// above (glowing-zooming-hamming.md Phase G) -- GET
// /sanctioned-strength/views/housekeeping has a genuinely different sortable
// column set (app/services/sanctioned_strength_views.py's own
// HOUSEKEEPING_STRENGTH_SORT_FIELDS): Location-grained (location_name/block/
// floor_venue/required/available/vacancy/status), no campus_code/
// department_name/designation_name/filled_pct/last_join/last_resignation/
// last_updated -- this view's row simply doesn't carry those fields (see
// api/types.ts's own HousekeepingStrengthRow docstring).
export type HousekeepingStrengthSortBy =
  | "location_name"
  | "block"
  | "floor_venue"
  | "required"
  | "available"
  | "vacancy"
  | "status";

export interface ListHousekeepingStrengthParams {
  limit?: number;
  offset?: number;
  sort_by?: HousekeepingStrengthSortBy;
  sort_dir?: SortDirection;
  campus_code?: string | null;
  location_id?: string | null;
  block?: string | null;
  /** Real live gap found and fixed (2026-08-17): floor_venue was already a
   * real field on this view's own rows but had no way to filter by it --
   * same case-insensitive-substring semantics as `block` above. */
  floor_venue?: string | null;
  shift?: string | null;
  search?: string | null;
  status?: HousekeepingStrengthStatus | null;
  vacancy?: number | null;
}

// Mirrors GET /sanctioned-strength/views/housekeeping -- returns the full
// response (not unwrapped to .items), same convention as
// listTeachingStrengthRows()/listNonTeachingStrengthRows() above. No
// department_id/designation_id params here -- this view has neither
// dimension (see app/services/sanctioned_strength_views.py's own
// list_housekeeping_strength_rows docstring for why).
export async function listHousekeepingStrengthRows(
  params: ListHousekeepingStrengthParams = {},
): Promise<HousekeepingStrengthListResponse> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  if (params.sort_by) query.set("sort_by", params.sort_by);
  if (params.sort_dir) query.set("sort_dir", params.sort_dir);
  if (params.campus_code) query.set("campus_code", params.campus_code);
  if (params.location_id) query.set("location_id", params.location_id);
  if (params.block) query.set("block", params.block);
  if (params.floor_venue) query.set("floor_venue", params.floor_venue);
  if (params.shift) query.set("shift", params.shift);
  if (params.search) query.set("search", params.search);
  if (params.status) query.set("status", params.status);
  if (params.vacancy !== undefined && params.vacancy !== null) {
    query.set("vacancy", String(params.vacancy));
  }

  const qs = query.toString();
  return apiFetch<HousekeepingStrengthListResponse>(`/sanctioned-strength/views/housekeeping${qs ? `?${qs}` : ""}`);
}
