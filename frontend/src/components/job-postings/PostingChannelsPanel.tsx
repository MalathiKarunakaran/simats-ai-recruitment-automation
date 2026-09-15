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
import type { JobPostingChannelRead, JobPostingRead, RecruitmentChannelRead } from "@/api/types";
import { ChannelConfigurationBadge, ChannelStatusBadge } from "@/components/job-postings/PostingStatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";

// Mirrors app/api/v1/routers/job_distribution.py: list/post/attempts need
// JOB_DISTRIBUTION; attach/review/manual reference need
// REVIEW_POSTING_CHANNELS or JOB_DISTRIBUTION. The caller resolves both.
interface PostingChannelsPanelProps {
  jobPosting: JobPostingRead;
  canPost: boolean;
  canReview: boolean;
  // The public careers URL, for the "posting content" a person pastes.
  applyUrl: string | null;
}

// Mirror app/models/enums.py's JOB_POSTING_CHANNEL_POSTABLE/LIVE_STATUSES.
const POSTABLE: ReadonlySet<string> = new Set(["SELECTED", "QUEUED", "FAILED"]);
const ON_POSTING: ReadonlySet<string> = new Set(["RECOMMENDED", "SELECTED", "QUEUED", "POSTED", "FAILED"]);

function todayIso(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** Sections E (Publish to) and F (Channel status). */
export function PostingChannelsPanel({ jobPosting, canPost, canReview, applyUrl }: PostingChannelsPanelProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const postingId = jobPosting.id;
  const closed = jobPosting.status === "CLOSED";
  const live = jobPosting.is_active;

  const { data: rows, isLoading } = useQuery({
    queryKey: ["posting-channels", postingId],
    queryFn: () => listPostingChannels(postingId),
    enabled: canPost,
  });
  const { data: allChannels } = useQuery({
    queryKey: ["recruitment-channels"],
    queryFn: () => listRecruitmentChannels(),
    enabled: canPost,
  });

  const [error, setError] = useState<string | null>(null);
  const [manualFor, setManualFor] = useState<JobPostingChannelRead | null>(null);
  const [manualRef, setManualRef] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [manualDate, setManualDate] = useState("");
  const [attemptsFor, setAttemptsFor] = useState<JobPostingChannelRead | null>(null);

  function refresh() {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ["posting-channels", postingId] });
    void queryClient.invalidateQueries({ queryKey: ["posting-history", postingId] });
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
          : `Recommended ${result.created.map((r) => r.channel_name).join(", ")}.`,
      );
    },
    onError: fail("Could not run the channel rules"),
  });
  const attach = useMutation({
    mutationFn: (channelId: string) => attachPostingChannel(postingId, channelId),
    onSuccess: refresh,
    onError: fail("Could not select the channel"),
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
      if (result.attempt.outcome !== "SUCCEEDED") {
        toast.error(`${result.channel.channel_name}: ${result.attempt.error_message ?? result.attempt.outcome}`);
      } else if (result.channel.status === "QUEUED") {
        toast.success(`${result.channel.channel_name}: ready for manual posting.`);
      } else {
        toast.success(`${result.channel.channel_name}: published.`);
      }
    },
    onError: fail("Could not post to the channel"),
  });
  const manual = useMutation({
    mutationFn: () =>
      recordManualPosting(postingId, manualFor!.channel_id, {
        external_ref: manualRef.trim() || null,
        external_url: manualUrl.trim() || null,
        posted_on: manualDate || null,
      }),
    onSuccess: () => {
      refresh();
      setManualFor(null);
      toast.success("Recorded as published.");
    },
    onError: fail("Could not record the posting"),
  });

  const { data: attempts } = useQuery({
    queryKey: ["posting-attempts", postingId, attemptsFor?.channel_id],
    queryFn: () => listPostingAttempts(postingId, attemptsFor!.channel_id),
    enabled: Boolean(attemptsFor),
  });

  if (!canPost) return null;

  const rowByChannelId = new Map((rows ?? []).map((row) => [row.channel_id, row]));
  const applies = (c: RecruitmentChannelRead) =>
    c.is_active &&
    (c.applicable_categories.length === 0 || c.applicable_categories.includes(jobPosting.role_category)) &&
    (c.applicable_campus_ids.length === 0 || c.applicable_campus_ids.includes(jobPosting.campus_id));
  // A channel already on the posting stays listed even if it was since
  // retired or narrowed to other categories.
  const listed = (allChannels ?? [])
    .filter((c) => applies(c) || rowByChannelId.has(c.id))
    .sort((a, b) => a.display_order - b.display_order || a.code.localeCompare(b.code));
  const attached = listed.flatMap((c) => {
    const row = rowByChannelId.get(c.id);
    return row ? [row] : [];
  });
  const busy = recommend.isPending || attach.isPending || review.isPending || post.isPending;

  const title = jobPosting.ad_title ?? jobPosting.position_title;
  const postingContent = [
    title,
    `${jobPosting.campus_name} · ${jobPosting.department_name}`,
    "",
    jobPosting.ad_body ?? "",
    applyUrl ? `\nApply: ${applyUrl}` : "",
  ]
    .join("\n")
    .trim();

  function copy(text: string, what: string) {
    void navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`);
  }

  function openManual(row: JobPostingChannelRead) {
    setManualFor(row);
    setManualRef(row.external_ref ?? "");
    setManualUrl(row.external_url ?? "");
    setManualDate("");
    setError(null);
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Publish to</CardTitle>
          {canReview && !closed ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => recommend.mutate()}>
              {recommend.isPending ? "Running rules…" : "Run channel rules"}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {error ? <p className="text-destructive">{error}</p> : null}
          {!live && !closed ? (
            <p className="text-xs text-muted-foreground">
              Choose channels now. They are posted once this job posting is published, and the careers page is posted
              automatically at that moment. Rules recommend; nothing is chosen for you.
            </p>
          ) : null}
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : listed.length === 0 ? (
            <p className="text-muted-foreground">No recruitment channels apply to this posting.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {listed.map((channel) => {
                const row = rowByChannelId.get(channel.id);
                const onPosting = Boolean(row && ON_POSTING.has(row.status));
                const selectable = !row || row.status === "REMOVED" || row.status === "RECOMMENDED";
                return (
                  <li
                    key={channel.id}
                    data-testid={`publish-to-${channel.code}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{channel.name}</span>
                        <ChannelConfigurationBadge status={channel.configuration_status} />
                      </div>
                      {row?.status === "RECOMMENDED" && row.recommendation_reason ? (
                        <span className="text-xs text-muted-foreground">
                          {row.recommended_by === "RULE" ? "Rule: " : "Suggested: "}
                          {row.recommendation_reason}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {onPosting && row ? (
                        <ChannelStatusBadge status={row.status} />
                      ) : (
                        <span className="text-xs text-muted-foreground">Not selected</span>
                      )}
                      {canReview && !closed && selectable ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            row?.status === "RECOMMENDED"
                              ? review.mutate({ channelId: channel.id, decision: "SELECT" })
                              : attach.mutate(channel.id)
                          }
                        >
                          Select
                        </Button>
                      ) : null}
                      {canReview && !closed && onPosting ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => review.mutate({ channelId: channel.id, decision: "REMOVE" })}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Channel status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {attached.length === 0 ? (
            <p className="text-muted-foreground">
              {closed ? "No channels were used for this posting." : "No channels selected yet."}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {attached.map((row) => {
                const postable = live && !closed && POSTABLE.has(row.status);
                const config = row.channel_configuration_status;
                return (
                  <li key={row.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0" data-testid={`channel-${row.channel_code}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{row.channel_name}</span>
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
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {row.posted_at ? <span>Published {new Date(row.posted_at).toLocaleDateString()}</span> : null}
                      {row.expires_at ? <span>Expires {new Date(row.expires_at).toLocaleDateString()}</span> : null}
                      {row.external_ref ? <span>Reference: {row.external_ref}</span> : null}
                    </div>
                    {row.external_url ? (
                      <a href={row.external_url} target="_blank" rel="noreferrer" className="text-xs break-all text-primary hover:underline">
                        {row.external_url}
                      </a>
                    ) : null}
                    {row.last_error ? <div className="text-xs text-destructive">{row.last_error}</div> : null}
                    {config === "NOT_CONFIGURED" && !closed && POSTABLE.has(row.status) ? (
                      <p className="text-xs text-muted-foreground">
                        Integration not configured. Post it by hand and record the reference instead.
                      </p>
                    ) : null}
                    {!live && !closed && POSTABLE.has(row.status) ? (
                      <p className="text-xs text-muted-foreground">Waiting for the job posting to be published.</p>
                    ) : null}
                    {postable ? (
                      <div className="flex flex-wrap gap-2">
                        {canPost && config === "AUTOMATIC" ? (
                          <Button size="sm" disabled={busy} onClick={() => post.mutate(row.channel_id)}>
                            Publish now
                          </Button>
                        ) : null}
                        {canPost && config === "READY" ? (
                          <Button size="sm" variant={row.status === "FAILED" ? "outline" : "default"} disabled={busy} onClick={() => post.mutate(row.channel_id)}>
                            {row.status === "FAILED" ? "Retry" : "Post"}
                          </Button>
                        ) : null}
                        {canPost && config === "MANUAL" && row.status !== "QUEUED" ? (
                          <Button size="sm" disabled={busy} onClick={() => post.mutate(row.channel_id)}>
                            Start manual posting
                          </Button>
                        ) : null}
                        {config === "MANUAL" || config === "NOT_CONFIGURED" ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => copy(jobPosting.ad_body ?? "", "Job description")}>
                              Copy job description
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => copy(postingContent, "Posting content")}>
                              Copy posting content
                            </Button>
                            {row.channel_posting_url ? (
                              <Button size="sm" variant="outline" asChild>
                                <a href={row.channel_posting_url} target="_blank" rel="noreferrer">
                                  Open {row.channel_name}
                                </a>
                              </Button>
                            ) : null}
                            {canReview ? (
                              <Button size="sm" variant="outline" disabled={busy} onClick={() => openManual(row)}>
                                Mark as published
                              </Button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(manualFor)} onOpenChange={(open) => !open && setManualFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {manualFor?.channel_name} as published</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Record where the posting went up: the portal's reference, its URL, or both.</p>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual_ref">Reference</Label>
              <Input id="manual_ref" value={manualRef} onChange={(e) => setManualRef(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual_url">URL</Label>
              <Input id="manual_url" value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="https://" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual_date">Published on (leave empty for today)</Label>
              <Input id="manual_date" type="date" max={todayIso()} value={manualDate} onChange={(e) => setManualDate(e.target.value)} />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualFor(null)}>
              Cancel
            </Button>
            <Button disabled={manual.isPending || (!manualRef.trim() && !manualUrl.trim())} onClick={() => manual.mutate()}>
              {manual.isPending ? "Saving…" : "Mark as published"}
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
    </>
  );
}
