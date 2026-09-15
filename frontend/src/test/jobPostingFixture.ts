import type { JobPostingRead } from "@/api/types";

/**
 * Neutral values for the JobPostingRead fields added with the job posting
 * review workflow (2026-09-15) -- detail facts, structured content, derived
 * position counts and the review trail. Spread into a fixture that predates
 * them and does not exercise them, so it keeps describing only what its own
 * test cares about.
 */
export const JOB_POSTING_DETAIL_DEFAULTS: Pick<
  JobPostingRead,
  | "vacancy_request_ref"
  | "last_edited_by_name"
  | "positions_requested"
  | "positions_filled"
  | "positions_remaining"
  | "campus_code"
  | "campus_name"
  | "department_name"
  | "designation_id"
  | "designation_name"
  | "priority"
  | "required_by"
  | "summary"
  | "responsibilities"
  | "required_qualification"
  | "required_experience"
  | "required_skills"
  | "preferred_skills"
  | "employment_type"
  | "location_id"
  | "location_label"
  | "salary_min"
  | "salary_max"
  | "ai_generated_at"
  | "created_by_id"
  | "created_by_name"
  | "submitted_for_review_by_id"
  | "submitted_for_review_by_name"
  | "submitted_for_review_at"
  | "approved_by_id"
  | "approved_by_name"
  | "approved_at"
  | "published_by_id"
  | "published_by_name"
> = {
  vacancy_request_ref: null,
  last_edited_by_name: null,
  positions_requested: 0,
  positions_filled: 0,
  positions_remaining: 0,
  campus_code: "SSE",
  campus_name: "SSE Campus",
  department_name: "Department",
  designation_id: null,
  designation_name: null,
  priority: "NORMAL",
  required_by: null,
  summary: null,
  responsibilities: null,
  required_qualification: null,
  required_experience: null,
  required_skills: null,
  preferred_skills: null,
  employment_type: null,
  location_id: null,
  location_label: null,
  salary_min: null,
  salary_max: null,
  ai_generated_at: null,
  created_by_id: null,
  created_by_name: null,
  submitted_for_review_by_id: null,
  submitted_for_review_by_name: null,
  submitted_for_review_at: null,
  approved_by_id: null,
  approved_by_name: null,
  approved_at: null,
  published_by_id: null,
  published_by_name: null,
};
