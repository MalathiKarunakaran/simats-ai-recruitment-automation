import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import {
  attachPostingChannel,
  listPostingAttempts,
  listPostingChannels,
  postPostingChannel,
  recommendPostingChannels,
  recordManualPosting,
  reviewPostingChannel,
} from "@/api/jobPostingChannels";
import { listRecruitmentChannels } from "@/api/recruitmentChannels";
import type { JobPostingChannelRead, JobPostingRead } from "@/api/types";
import { ChannelStatusBadge } from "@/components/job-postings/PostingStatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

// Mirrors app/api/v1/routers/job_distribution.py: list/post/attempts need
// JOB_DISTRIBUTION; attach/review/manual reference need
// REVIEW_POSTING_CHANNELS or JOB_DISTRIBUTION. The caller resolves both.
interface PostingChannelsPanelProps {
  jobPosting: JobPostingRead;
  canPost: boolean;
  canReview: boolean;
}

const POSTABLE: ReadonlySet<string> = new Set(["SELECTED", "QUEUED", "FAILED"]);
const LIVE: ReadonlySet<string> = new Set(["RECOMMENDED", "SELECTED", "QUEUED", "POSTED", "FAILED"]);

function modeLabel(mode: JobPostingChannelRead["channel_mode"]): string {
  switch (mode) {
    case "API":
      return "via n8n";
    case "FEED":
      return "feed";
    case "MANUAL_ASSISTED":
      return "manual";
    case "INTERNAL":
      return "internal";
  }
}

export function PostingChannelsPanel({ jobPosting, canPost, canReview }: PostingChannelsPanelProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const postingId = jobPosting.id;
  const closed = jobPosting.status === "CLOSED";

  const { data: rows, isLoading } = useQuery({
    queryKey: ["posting-channels", postingId],
    queryFn: () => listPostingChannels(postingId),
    enabled: canPost,
  });
  const { data: allChannels } = useQuery({
    queryKey: ["recruitment-channels"],
    queryFn: () => listRecruitmentChannels(),
    enabled: canReview && !closed,
  });

  const [error, setError] = useState<string | null>(null);
  const [attachChannelId, setAttachChannelId] = useState("");
  const [manualFor, setManualFor] = useState<JobPostingChannelRead | null>(null);
  const [manualRef, setManualRef] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [attemptsFor, setAttemptsFor] = useState<JobPostingChannelRead | null>(null);

  function refresh() {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ["posting-channels", postingId] });
  }
  function fail(fallback: string) {
    return (err: unknown) => setError(err instanceof ApiError ? err.message : fallback);
  }

  const recommend = useMutation({
    mutationFn: () => recommendPostingChannels(postingId),
    onSuccess: (result) => {
      refresh();
      toast.success(
        result.created.length === 0
          ? "No new channels to recommend."
          : `Recommended ${result.created.map((r) => r.channel_code).join(", ")}.`,
      );
    },
    onError: fail("Could not run the channel rules"),
  });
  const attach = useMutation({
    mutationFn: (channelId: string) => attachPostingChannel(postingId, channelId),
    onSuccess: () => {
      refresh();
      setAttachChannelId("");
    },
    onError: fail("Could not add the channel"),
  });
  const review = useMutation({
    mutationFn: ({ channelId, decision }: { channelId: string; decision: "SELECT" | "REMOVE" }) =>
      reviewPostingChannel(postingId, channelId, decision),
    onSuccess: refresh,
    onError: fail("Could not update the channel"),
  });
  const post = useMutation({
    mutationFn: (channelId: string) => postPostingChannel(postingId, channelId),
    onSuccess: (result) => {
      refresh();
      if (result.attempt.outcome === "SUCCEEDED") {
        toast.success(`${result.channel.channel_code}: ${result.channel.status === "QUEUED" ? "queued for manual posting" : "posted"}.`);
      } else {
        toast.error(`${result.channel.channel_code}: ${result.attempt.error_message ?? result.attempt.outcome}`);
      }
    },
    onError: fail("Could not post to the channel"),
  });
  const manual = useMutation({
    mutationFn: () =>
      recordManualPosting(postingId, manualFor!.channel_id, {
        external_ref: manualRef.trim() || null,
        external_url: manualUrl.trim() || null,
      }),
    onSuccess: () => {
      refresh();
      setManualFor(null);
      setManualRef("");
      setManualUrl("");
    },
    onError: fail("Could not record the posting"),
  });

  const { data: attempts } = useQuery({
    queryKey: ["posting-attempts", postingId, attemptsFor?.channel_id],
    queryFn: () => listPostingAttempts(postingId, attemptsFor!.channel_id),
    enabled: Boolean(attemptsFor),
  });

  const attachedIds = new Set((rows ?? []).filter((r) => r.status !== "REMOVED").map((r) => r.channel_id));
  const attachable = (allChannels ?? []).filter(
    (c) =>
      c.is_active &&
      !attachedIds.has(c.id) &&
      (c.applicable_categories.length === 0 || c.applicable_categories.includes(jobPosting.role_category)) &&
      (c.applicable_campus_ids.length === 0 || c.applicable_campus_ids.includes(jobPosting.campus_id)),
  );
  const busy = recommend.isPending || attach.isPending || review.isPending || post.isPending;

  if (!canPost) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Channels</CardTitle>
        {canReview && !closed ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => recommend.mutate()}>
            {recommend.isPending ? "Running rules…" : "Run channel rules"}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {error ? <p className="text-destructive">{error}</p> : null}

        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : !rows || rows.length === 0 ? (
          <p className="text-muted-foreground">
            {closed ? "No channels were used for this posting." : "No channels yet. Run the channel rules or add one."}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((row) => {
              const postable = !closed && POSTABLE.has(row.status);
              const live = !closed && LIVE.has(row.status);
              return (
                <li key={row.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0" data-testid={`channel-${row.channel_code}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{row.channel_name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{row.channel_code}</span>
                    <span className="text-xs text-muted-foreground">({modeLabel(row.channel_mode)})</span>
                    <ChannelStatusBadge status={row.status} />
                    {row.attempt_count > 0 ? (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                        onClick={() => setAttemptsFor(row)}
                      >
                        {row.attempt_count} attempt{row.attempt_count === 1 ? "" : "s"}
                      </button>
                    ) : null}
                  </div>
                  {row.recommendation_reason ? (
                    <div className="text-xs text-muted-foreground">
                      {row.recommended_by === "RULE" ? "Rule: " : row.recommended_by === "AI" ? "Suggested: " : ""}
                      {row.recommendation_reason}
                    </div>
                  ) : null}
                  {row.external_url ? (
                    <a href={row.external_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                      {row.external_url}
                    </a>
                  ) : row.external_ref ? (
                    <div className="text-xs text-muted-foreground">Reference: {row.external_ref}</div>
                  ) : null}
                  {row.last_error ? <div className="text-xs text-destructive">{row.last_error}</div> : null}
                  {live ? (
                    <div className="flex flex-wrap gap-2">
                      {canReview && row.status === "RECOMMENDED" ? (
                        <Button size="sm" disabled={busy} onClick={() => review.mutate({ channelId: row.channel_id, decision: "SELECT" })}>
                          Select
                        </Button>
                      ) : null}
                      {postable ? (
                        <Button size="sm" variant={row.status === "FAILED" ? "outline" : "default"} disabled={busy} onClick={() => post.mutate(row.channel_id)}>
                          {row.status === "FAILED" ? "Retry" : row.channel_mode === "MANUAL_ASSISTED" && row.status !== "QUEUED" ? "Prepare" : "Post"}
                        </Button>
                      ) : null}
                      {canReview && postable ? (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => setManualFor(row)}>
                          Record reference
                        </Button>
                      ) : null}
                      {canReview ? (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => review.mutate({ channelId: row.channel_id, decision: "REMOVE" })}>
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {canReview && !closed ? (
          <div className="flex items-end gap-2">
            <div className="flex w-64 flex-col gap-1.5">
              <Label>Add a channel</Label>
              <Select value={attachChannelId} onValueChange={setAttachChannelId}>
                <SelectTrigger aria-label="Add a channel">
                  <SelectValue placeholder={attachable.length === 0 ? "No more channels apply" : "Choose a channel"} />
                </SelectTrigger>
                <SelectContent>
                  {attachable.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" disabled={!attachChannelId || busy} onClick={() => attach.mutate(attachChannelId)}>
              Add
            </Button>
          </div>
        ) : null}
      </CardContent>

      <Dialog open={Boolean(manualFor)} onOpenChange={(open) => !open && setManualFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record where it was posted</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {manualFor?.channel_name}: paste the portal's reference, its URL, or both.
          </p>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual_ref">Reference</Label>
              <Input id="manual_ref" value={manualRef} onChange={(e) => setManualRef(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual_url">URL</Label>
              <Input id="manual_url" value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="https://" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualFor(null)}>
              Cancel
            </Button>
            <Button disabled={manual.isPending || (!manualRef.trim() && !manualUrl.trim())} onClick={() => manual.mutate()}>
              {manual.isPending ? "Saving…" : "Mark as posted"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(attemptsFor)} onOpenChange={(open) => !open && setAttemptsFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Attempts on {attemptsFor?.channel_name}</DialogTitle>
          </DialogHeader>
          {!attempts ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {attempts.map((a) => (
                <li key={a.id} className="flex flex-col gap-1 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">#{a.attempt_number}</span>
                    <span className="text-xs text-muted-foreground">{a.trigger.replace(/_/g, " ").toLowerCase()}</span>
                    <span className={a.outcome === "SUCCEEDED" ? "text-brand-success" : "text-destructive"}>
                      {a.outcome.replace(/_/g, " ").toLowerCase()}
                    </span>
                    <span className="text-xs text-muted-foreground">{new Date(a.attempted_at).toLocaleString()}</span>
                  </div>
                  {a.error_message ? <div className="text-xs text-destructive">{a.error_message}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
