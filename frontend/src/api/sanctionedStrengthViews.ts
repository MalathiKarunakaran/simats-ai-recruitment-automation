import { apiFetch } from "@/api/client";
import type { SortDirection } from "@/api/sanctionedStrength";
import type { TeachingStrengthListResponse, TeachingStrengthStatus } from "@/api/types";

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
