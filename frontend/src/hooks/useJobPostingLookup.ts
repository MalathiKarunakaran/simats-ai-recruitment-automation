import { useQuery } from "@tanstack/react-query";

import { listApprovedVacancies } from "@/api/approvedVacancies";
import { listJobPostings } from "@/api/jobPostings";
import { listVacancyRequests } from "@/api/vacancyRequests";

export interface JobPostingLabel {
  positionTitle: string;
  campusId: string;
  slug: string;
}

/** Applications only store job_posting_id -- there's no backend endpoint that
 * joins JobPosting -> ApprovedVacancy -> VacancyRequest for a human-readable
 * position title, so this mirrors the client-side join pattern already used
 * for campuses elsewhere (fetch full lists, look up by id). */
export function useJobPostingLookup() {
  const { data: jobPostings, isLoading: jobPostingsLoading } = useQuery({
    queryKey: ["job-postings"],
    queryFn: listJobPostings,
  });
  const { data: approvedVacancies, isLoading: approvedVacanciesLoading } = useQuery({
    queryKey: ["approved-vacancies"],
    queryFn: listApprovedVacancies,
  });
  const { data: vacancyRequests, isLoading: vacancyRequestsLoading } = useQuery({
    queryKey: ["vacancy-requests", "ALL"],
    queryFn: () => listVacancyRequests(null),
  });

  function getLabel(jobPostingId: string): JobPostingLabel | undefined {
    const jobPosting = jobPostings?.find((jp) => jp.id === jobPostingId);
    if (!jobPosting) return undefined;
    const approvedVacancy = approvedVacancies?.find((av) => av.id === jobPosting.approved_vacancy_id);
    const vacancyRequest = approvedVacancy
      ? vacancyRequests?.find((vr) => vr.id === approvedVacancy.vacancy_request_id)
      : undefined;
    return {
      positionTitle: vacancyRequest?.position_title ?? "Unknown position",
      campusId: jobPosting.campus_id,
      slug: jobPosting.public_apply_slug,
    };
  }

  return {
    getLabel,
    jobPostings,
    isLoading: jobPostingsLoading || approvedVacanciesLoading || vacancyRequestsLoading,
  };
}
