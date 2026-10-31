import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { listHodReviews, openHodReviewFile, recordHodReview } from "@/api/joining";
import { HOD_RECOMMENDATION_LABELS, JOINING_DOCUMENT_ACCEPT } from "@/api/types";
import type { ApplicationRead, HodRecommendation } from "@/api/types";
import { HOD_REVIEW_STATUSES, formatDate } from "@/components/joining/postHandover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const RECOMMENDATIONS = Object.keys(HOD_RECOMMENDATION_LABELS) as HodRecommendation[];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** HOD review (docs/specs/hod-review-and-permanent-order.md): at
 * HANDED_OVER_TO_HOD the review can be recorded; only "Recommend for
 * permanent" moves the application on. Every review is kept and shown,
 * latest first, with the probation end in force. */
export function HodReviewSection({
  application,
  canRecord,
  onChanged,
}: {
  application: ApplicationRead;
  canRecord: boolean;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  // null = untouched, so the box shows the HOD typed at hand-over.
  const [hodName, setHodName] = useState<string | null>(null);
  const [reviewDate, setReviewDate] = useState(today());
  const [recommendation, setRecommendation] = useState<HodRecommendation | "">("");
  const [newProbationEnd, setNewProbationEnd] = useState("");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const visible = HOD_REVIEW_STATUSES.has(application.status);
  const { data: history } = useQuery({
    queryKey: ["hod-reviews", application.id],
    queryFn: () => listHodReviews(application.id),
    enabled: visible,
    retry: false,
  });

  const recordMutation = useMutation({
    mutationFn: () =>
      recordHodReview(application.id, {
        hod_name: (hodName ?? history?.hod_assigned ?? "").trim(),
        review_date: reviewDate,
        recommendation: recommendation as HodRecommendation,
        new_probation_end_date: recommendation === "EXTEND_PROBATION" ? newProbationEnd : null,
        remarks: remarks.trim() || null,
        file,
      }),
    onSuccess: () => {
      setError(null);
      setRecommendation("");
      setNewProbationEnd("");
      setRemarks("");
      setFile(null);
      void queryClient.invalidateQueries({ queryKey: ["hod-reviews", application.id] });
      void queryClient.invalidateQueries({ queryKey: ["provisional-order", application.id] });
      void queryClient.invalidateQueries({ queryKey: ["onboarding-probation"] });
      onChanged();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not record the review"),
  });
  const fileMutation = useMutation({
    mutationFn: (reviewId: string) => openHodReviewFile(application.id, reviewId),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not open the file"),
  });

  if (!visible) return null;

  const shownHodName = hodName ?? history?.hod_assigned ?? "";
  const canSubmit =
    !recordMutation.isPending &&
    Boolean(shownHodName.trim()) &&
    Boolean(reviewDate) &&
    Boolean(recommendation) &&
    (recommendation !== "EXTEND_PROBATION" || Boolean(newProbationEnd));
  const showForm = canRecord && application.status === "HANDED_OVER_TO_HOD";

  return (
    <section aria-label="HOD review" className="flex flex-col gap-3 rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">HOD review</h3>
        {history ? (
          <div>
            <span className="text-muted-foreground">Probation ends </span>
            <span className="font-medium">
              {history.probation_end_date ? formatDate(history.probation_end_date) : "—"}
            </span>
            {history.probation_end_date &&
            history.provisional_probation_end_date &&
            history.probation_end_date !== history.provisional_probation_end_date ? (
              <span className="text-xs text-muted-foreground">
                {" "}
                (extended from {formatDate(history.provisional_probation_end_date)})
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {showForm ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hod_review_name">HOD name</Label>
              <Input id="hod_review_name" value={shownHodName} onChange={(e) => setHodName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hod_review_date">Review date</Label>
              <Input
                id="hod_review_date"
                type="date"
                value={reviewDate}
                onChange={(e) => setReviewDate(e.target.value)}
              />
            </div>
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium">Recommendation</legend>
            {RECOMMENDATIONS.map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`hod-recommendation-${application.id}`}
                  value={value}
                  checked={recommendation === value}
                  onChange={() => setRecommendation(value)}
                />
                {HOD_RECOMMENDATION_LABELS[value]}
              </label>
            ))}
          </fieldset>
          {recommendation === "EXTEND_PROBATION" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hod_review_new_end">New probation end date</Label>
              <Input
                id="hod_review_new_end"
                type="date"
                required
                className="max-w-xs"
                value={newProbationEnd}
                onChange={(e) => setNewProbationEnd(e.target.value)}
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hod_review_remarks">Remarks (optional)</Label>
            <Textarea id="hod_review_remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hod_review_file">Signed review (optional)</Label>
            <input
              id="hod_review_file"
              type="file"
              accept={JOINING_DOCUMENT_ACCEPT}
              className="text-sm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Only "Recommend for permanent" completes the review. Extending keeps the stage and moves the probation
            end; "Not recommended" is recorded and the stage stays (separation is done through offboarding).
          </p>
          <Button className="w-fit" disabled={!canSubmit} onClick={() => recordMutation.mutate()}>
            {recordMutation.isPending ? "Recording…" : "Record HOD review"}
          </Button>
        </div>
      ) : null}

      {history && history.items.length > 0 ? (
        <ol aria-label="Review history" className="m-0 flex list-none flex-col gap-2 p-0">
          {history.items.map((review, index) => (
            <li key={review.id} className="flex flex-col gap-1 rounded-md bg-muted/40 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={review.recommendation === "RECOMMEND_PERMANENT" ? "success" : review.recommendation === "NOT_RECOMMENDED" ? "warning" : "outline"}>
                  {HOD_RECOMMENDATION_LABELS[review.recommendation]}
                </Badge>
                {index === 0 ? <span className="text-xs text-muted-foreground">Latest</span> : null}
                <span>
                  {formatDate(review.review_date)} · {review.hod_name}
                </span>
                {review.new_probation_end_date ? (
                  <span className="text-muted-foreground">
                    New probation end {formatDate(review.new_probation_end_date)}
                  </span>
                ) : null}
                {review.file_content_type ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={fileMutation.isPending}
                    onClick={() => fileMutation.mutate(review.id)}
                    aria-label={`View signed review of ${formatDate(review.review_date)}`}
                  >
                    View signed review
                  </Button>
                ) : null}
              </div>
              {review.remarks ? <p className="text-muted-foreground">{review.remarks}</p> : null}
            </li>
          ))}
        </ol>
      ) : history ? (
        <p className="text-muted-foreground">No HOD review recorded yet.</p>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
