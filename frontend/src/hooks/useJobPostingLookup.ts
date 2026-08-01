import { useQuery } from "@tanstack/react-query";

import { listJobPostings } from "@/api/jobPostings";

export interface JobPostingLabel {
  positionTitle: string;
  campusId: string;
  slug: string;
}

/** Applications only store job_posting_id, not a human-readable position
 * title -- JobPostingRead carries position_title directly (a JobPosting
 * model @property resolved server-side via its approved_vacancy ->
 * vacancy_request relationship), so this is now just a by-id lookup over
 * one already-fetched list rather than a client-side 3-hop join. */
export function useJobPostingLookup() {
  const { data: jobPostings, isLoading } = useQuery({
    queryKey: ["job-postings"],
    queryFn: listJobPostings,
  });

  function getLabel(jobPostingId: string): JobPostingLabel | undefined {
    const jobPosting = jobPostings?.find((jp) => jp.id === jobPostingId);
    if (!jobPosting) return undefined;
    return {
      positionTitle: jobPosting.position_title,
      campusId: jobPosting.campus_id,
      slug: jobPosting.public_apply_slug,
    };
  }

  return { getLabel, jobPostings, isLoading };
}
