import { publicFetch } from "@/api/client";

// The public QR intake form's own API module (2026-08-30). Everything here
// goes through `publicFetch`, NOT `apiFetch`: this form is reachable without
// signing in, and apiFetch's 401 handler would try to refresh a token that
// does not exist and bounce the visitor to /login mid-submission.

export interface PublicFormCampus {
  id: string;
  code: string;
  name: string;
}

export interface PublicFormDepartment {
  id: string;
  name: string;
  campus_id: string;
  /** Which staff categories this department may contain -- a MEMBERSHIP list,
   * never a single category (see CLAUDE.md). Drives which designations the
   * form offers, so a Non-Teaching designation is not selectable on a
   * Teaching-only department and then refused with a 400 at submit.
   *
   * Optional so an older backend that does not send it degrades to "offer
   * everything" rather than to an empty designation list. */
  supported_categories?: string[];
}

export interface PublicFormDesignation {
  id: string;
  name: string;
  category: string;
}

/** block_building/floor_venue come through so the picker can render the same
 * "Block - Floor" label the authenticated screens use -- `name` alone repeats
 * across floors and is not distinguishable. */
export interface PublicFormLocation {
  id: string;
  name: string;
  block_building: string | null;
  floor_venue: string | null;
  campus_id: string;
}

export interface PublicFormOptions {
  campuses: PublicFormCampus[];
  departments: PublicFormDepartment[];
  designations: PublicFormDesignation[];
  locations: PublicFormLocation[];
}

export interface PublicVacancyRequestPayload {
  campus_id: string;
  department_id: string;
  designation_id: string;
  /** Required since 2026-09-02 -- see PublicVacancyRequestCreate.location_id. */
  location_id: string;
  number_of_positions: number;
  priority: string;
  required_by?: string | null;
  justification: string;
  requester_name: string;
  requester_email: string;
  requester_mobile: string;
  /** Honeypot (audit L5): rendered off-screen and always sent empty by the
   * page; the backend discards any submission that fills it. */
  website?: string;
}

/** Deliberately only three fields -- the backend exposes no internal ids to a
 * public submitter. */
export interface PublicVacancyRequestConfirmation {
  request_ref: string;
  status: string;
  submitted_at: string | null;
}

export async function getPublicFormOptions(campusId?: string | null): Promise<PublicFormOptions> {
  const query = campusId ? `?campus_id=${encodeURIComponent(campusId)}` : "";
  return publicFetch<PublicFormOptions>(`/public/vacancy-requests/form-options${query}`);
}

export async function submitPublicVacancyRequest(
  payload: PublicVacancyRequestPayload,
): Promise<PublicVacancyRequestConfirmation> {
  return publicFetch<PublicVacancyRequestConfirmation>("/public/vacancy-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
