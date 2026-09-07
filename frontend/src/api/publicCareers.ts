import { publicFetch } from "@/api/client";
import type { JobPostingStatus, StaffRoleCategory } from "@/api/types";

// The public careers pages' API module (2026-09-07). Everything here goes
// through `publicFetch`, NOT `apiFetch`: a candidate is never signed in, and
// apiFetch's 401 handler would try to refresh a token that does not exist and
// bounce them to /login mid-application.

// Mirrors app/schemas/public_careers.py::PublicJobPostingSummary.
export interface PublicJobPostingSummary {
  posting_number: string | null;
  public_apply_slug: string;
  title: string;
  campus_code: string;
  campus_name: string;
  department_name: string;
  role_category: StaffRoleCategory;
  employment_type: string;
  qualification: string;
  experience_required: string;
  positions_open: number;
  apply_deadline: string | null;
  published_at: string;
}

// Mirrors app/schemas/public_careers.py::PublicJobPostingDetail.
export interface PublicJobPostingDetail extends PublicJobPostingSummary {
  ad_body: string;
  contact_email: string | null;
  status: JobPostingStatus;
  is_accepting_applications: boolean;
}

export interface PublicJobPostingList {
  items: PublicJobPostingSummary[];
  total: number;
}

// Mirrors app/schemas/public_careers.py::PublicApplicationConfirmation.
export interface PublicApplicationConfirmation {
  posting_number: string | null;
  title: string;
  applicant_name: string;
  applied_at: string;
}

export interface PublicPostingFilters {
  campus?: string;
  role_category?: StaffRoleCategory | "";
  q?: string;
}

export async function listPublicPostings(filters: PublicPostingFilters = {}): Promise<PublicJobPostingList> {
  const params = new URLSearchParams();
  if (filters.campus) params.set("campus", filters.campus);
  if (filters.role_category) params.set("role_category", filters.role_category);
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  params.set("limit", "100");
  return publicFetch<PublicJobPostingList>(`/public/careers/postings?${params.toString()}`);
}

export async function getPublicPosting(slug: string): Promise<PublicJobPostingDetail> {
  return publicFetch<PublicJobPostingDetail>(`/public/careers/postings/${encodeURIComponent(slug)}`);
}

export interface PublicApplicationInput {
  full_name: string;
  email: string;
  phone_number: string;
  resume: File;
  /** Honeypot -- must be sent, must stay empty. */
  website: string;
}

export async function applyToPublicPosting(
  slug: string,
  input: PublicApplicationInput,
): Promise<PublicApplicationConfirmation> {
  const formData = new FormData();
  formData.append("full_name", input.full_name);
  formData.append("email", input.email);
  if (input.phone_number) formData.append("phone_number", input.phone_number);
  formData.append("website", input.website);
  formData.append("resume", input.resume, input.resume.name);
  return publicFetch<PublicApplicationConfirmation>(
    `/public/careers/postings/${encodeURIComponent(slug)}/apply`,
    { method: "POST", body: formData },
  );
}
