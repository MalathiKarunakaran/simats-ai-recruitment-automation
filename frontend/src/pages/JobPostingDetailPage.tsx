import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";

import { getJobPosting, rankCandidates } from "@/api/jobPostings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

export function JobPostingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { getLabel } = useJobPostingLookup();

  const { data: jobPosting, isLoading } = useQuery({
    queryKey: ["job-posting", id],
    queryFn: () => getJobPosting(id!),
    enabled: Boolean(id),
  });

  const { data: rankedCandidates } = useQuery({
    queryKey: ["candidate-ranking", id],
    queryFn: () => rankCandidates(id!),
    enabled: Boolean(id),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!jobPosting) {
    return <Navigate to="/applications" replace />;
  }

  const label = getLabel(jobPosting.id);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{label?.positionTitle ?? "Job Posting"}</h1>
        <Button variant="outline" size="sm" asChild>
          <Link to="/applications">Back to applications</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Posting</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Published</div>
            <div>{new Date(jobPosting.published_at).toLocaleDateString()}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Status</div>
            <div>{jobPosting.is_active ? "Active" : "Closed"}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ranked Candidates</CardTitle>
        </CardHeader>
        <CardContent>
          {!rankedCandidates || rankedCandidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No applications for this posting yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 font-medium">Candidate</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Overall score</th>
                  <th className="py-2 font-medium">Eligibility score</th>
                  <th className="py-2 font-medium">Flags</th>
                </tr>
              </thead>
              <tbody>
                {rankedCandidates.map((row) => (
                  <tr key={row.application_id} className="border-b border-border last:border-0 hover:bg-accent/50">
                    <td className="py-2">
                      <Link to={`/applications/${row.application_id}`} className="font-medium hover:underline">
                        {row.candidate_full_name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{row.candidate_email}</div>
                    </td>
                    <td className="py-2">{row.application_status.replace(/_/g, " ")}</td>
                    <td className="py-2">{row.overall_recruitment_score ?? "—"}</td>
                    <td className="py-2">{row.eligibility_score ?? "—"}</td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        {row.is_duplicate ? <Badge variant="warning">Duplicate</Badge> : null}
                        {row.is_incomplete_profile ? <Badge variant="warning">Incomplete</Badge> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
