import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";

import { getCandidate } from "@/api/candidates";
import { listApplications } from "@/api/applications";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResumeUpload } from "@/components/candidates/ResumeUpload";
import { StatusBadge } from "@/components/applications/StatusBadge";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

export function CandidateDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: candidate, isLoading } = useQuery({
    queryKey: ["candidate", id],
    queryFn: () => getCandidate(id!),
    enabled: Boolean(id),
  });

  const { data: applications } = useQuery({
    queryKey: ["applications", { candidateId: id }],
    queryFn: () => listApplications({ candidateId: id }),
    enabled: Boolean(id),
  });

  const { getLabel } = useJobPostingLookup();

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!candidate) {
    return <Navigate to="/candidates" replace />;
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{candidate.full_name}</h1>
        <Button variant="outline" size="sm" asChild>
          <Link to="/candidates">Back to list</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Email</div>
            <div>{candidate.email}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Phone</div>
            <div>{candidate.phone_number ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Source</div>
            <div>{candidate.source ?? "—"}</div>
          </div>
          {candidate.source === "Reference" && candidate.reference_name ? (
            <div>
              <div className="text-muted-foreground">Reference name</div>
              <div>{candidate.reference_name}</div>
            </div>
          ) : null}
          <div className="col-span-2">
            <div className="mb-1 text-muted-foreground">Resume</div>
            <ResumeUpload candidate={candidate} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Applications</CardTitle>
        </CardHeader>
        <CardContent>
          {!applications || applications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No applications recorded for this candidate yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {applications.map((application) => {
                const label = getLabel(application.job_posting_id);
                return (
                  <li key={application.id} className="flex items-center justify-between text-sm">
                    <Link to={`/applications/${application.id}`} className="hover:underline">
                      {label?.positionTitle ?? "Unknown position"}
                    </Link>
                    <StatusBadge status={application.status} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
