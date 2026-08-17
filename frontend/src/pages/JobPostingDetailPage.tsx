import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { distributeJobPosting, getJobAd, getQrCodeBlob } from "@/api/jobDistribution";
import { getJobPosting, rankCandidates } from "@/api/jobPostings";
import type { DistributeResponse, JobPortal } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

const DISTRIBUTE_ROLES = ["RECRUITMENT_OFFICER", "HR_ADMIN", "SUPER_ADMIN", "RECRUITMENT_COORDINATOR"];
const SUPPORTED_PORTALS: JobPortal[] = ["LINKEDIN", "INDEED", "NAUKRI", "FACULTYPLUS"];

export function JobPostingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { getLabel } = useJobPostingLookup();
  const canDistribute = Boolean(user && DISTRIBUTE_ROLES.includes(user.role));

  const [distributionError, setDistributionError] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [selectedPortals, setSelectedPortals] = useState<JobPortal[]>(SUPPORTED_PORTALS);
  const [distributeResult, setDistributeResult] = useState<DistributeResponse | null>(null);

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

  const { data: jobAd, isLoading: jobAdLoading } = useQuery({
    queryKey: ["job-ad", id],
    queryFn: () => getJobAd(id!),
    enabled: Boolean(id) && canDistribute,
  });

  useEffect(() => {
    return () => {
      if (qrCodeUrl) URL.revokeObjectURL(qrCodeUrl);
    };
  }, [qrCodeUrl]);

  const qrCodeMutation = useMutation({
    mutationFn: () => getQrCodeBlob(id!),
    onSuccess: (blob) => {
      setDistributionError(null);
      setQrCodeUrl(URL.createObjectURL(blob));
    },
    onError: (err: unknown) => setDistributionError(err instanceof ApiError ? err.message : "QR code generation failed"),
  });

  const distributeMutation = useMutation({
    mutationFn: (portals: JobPortal[]) => distributeJobPosting(id!, portals),
    onSuccess: (result) => {
      setDistributionError(null);
      setDistributeResult(result);
    },
    onError: (err: unknown) => setDistributionError(err instanceof ApiError ? err.message : "Distribution failed"),
  });

  function togglePortal(portal: JobPortal) {
    setSelectedPortals((prev) => (prev.includes(portal) ? prev.filter((p) => p !== portal) : [...prev, portal]));
  }

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

      {canDistribute ? (
        <Card>
          <CardHeader>
            <CardTitle>Distribution</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 text-sm">
            {distributionError ? <p className="text-destructive">{distributionError}</p> : null}

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-muted-foreground">Job ad text</span>
                {jobAd ? (
                  <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(jobAd.body)}>
                    Copy
                  </Button>
                ) : null}
              </div>
              {jobAdLoading ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : jobAd ? (
                <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-sans text-xs">
                  {jobAd.body}
                </pre>
              ) : (
                <p className="text-muted-foreground">No job ad available.</p>
              )}
            </div>

            <div>
              <div className="mb-1 text-muted-foreground">QR code (apply link)</div>
              {qrCodeUrl ? (
                <div className="flex items-center gap-3">
                  <img src={qrCodeUrl} alt="Apply QR code" className="h-32 w-32 rounded-md border border-border" />
                  <Button variant="outline" size="sm" asChild>
                    <a href={qrCodeUrl} download={`job-posting-${jobPosting.id}-qr.png`}>
                      Download PNG
                    </a>
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={qrCodeMutation.isPending}
                  onClick={() => qrCodeMutation.mutate()}
                >
                  {qrCodeMutation.isPending ? "Generating…" : "Generate QR code"}
                </Button>
              )}
            </div>

            <div>
              <div className="mb-2 text-muted-foreground">Distribute to portals</div>
              <div className="mb-2 flex flex-wrap gap-2">
                {SUPPORTED_PORTALS.map((portal) => (
                  <Button
                    key={portal}
                    type="button"
                    size="sm"
                    variant={selectedPortals.includes(portal) ? "default" : "outline"}
                    onClick={() => togglePortal(portal)}
                  >
                    {portal}
                  </Button>
                ))}
              </div>
              <Button
                size="sm"
                disabled={selectedPortals.length === 0 || distributeMutation.isPending}
                onClick={() => distributeMutation.mutate(selectedPortals)}
              >
                {distributeMutation.isPending ? "Distributing…" : "Distribute"}
              </Button>
              {distributeResult ? (
                <p className="mt-2 text-xs text-muted-foreground">Sent to: {distributeResult.portals.join(", ")}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Ranked Candidates</CardTitle>
        </CardHeader>
        {/* UI redesign Phase 3 -- p-0 + an explicit overflow-x-auto wrapper
            around the table itself (matching every other page's table
            region), rather than CardContent's default p-6 padding doubling
            up with the table's own per-cell padding. */}
        <CardContent className="p-0">
          {!rankedCandidates || rankedCandidates.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No applications for this posting yet.</p>
          ) : (
            <div className="overflow-x-auto">
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
                    <tr
                      key={row.application_id}
                      className="border-b border-border last:border-0 hover:bg-accent/50"
                    >
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
