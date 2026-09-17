import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ApiError } from "@/api/client";
import { getPosterBlob } from "@/api/jobDistribution";
import {
  generatePosterBackground,
  generatePosterCopy,
  getContentGenerationStatus,
  getPosterBackgroundBlob,
  getPosterBackgroundStatus,
  setPosterBackgroundEnabled,
  updatePosterCopy,
} from "@/api/jobPostings";
import type { JobPostingPosterCopyPayload, JobPostingRead } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

// The A4 template lays out at most five bullets, and the backend REJECTS a
// sixth with a 422 rather than dropping it -- so the form never offers one.
const MAX_BULLETS = 5;
const HEADLINE_MAX = 60;
const PITCH_MAX = 240;

interface CopyForm {
  headline: string;
  pitch: string;
  bullets: string[];
}

function formFrom(posting: JobPostingRead): CopyForm {
  const bullets = [...(posting.poster_bullets ?? [])];
  while (bullets.length < 3) bullets.push("");
  return {
    headline: posting.poster_headline ?? "",
    pitch: posting.poster_pitch ?? "",
    bullets: bullets.slice(0, MAX_BULLETS),
  };
}

interface PosterCardProps {
  jobPosting: JobPostingRead;
  canEdit: boolean;
  canDownload: boolean;
  onChanged: () => void;
}

export function PosterCard({ jobPosting, canEdit, canDownload, onChanged }: PosterCardProps) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<CopyForm>(() => formFrom(jobPosting));
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const closed = jobPosting.status === "CLOSED";
  const hasCopy = Boolean(jobPosting.poster_headline || jobPosting.poster_pitch || jobPosting.poster_bullets?.length);
  // Nothing to write poster wording FROM until the advertisement has text;
  // the backend refuses with a 400 and this says so before the click.
  const hasSource = Boolean(jobPosting.ad_body || jobPosting.summary);

  const { data: copyAiStatus } = useQuery({
    queryKey: ["content-generation-status"],
    queryFn: getContentGenerationStatus,
    enabled: canEdit && !closed,
  });
  const { data: imageAiStatus } = useQuery({
    queryKey: ["poster-background-status"],
    queryFn: getPosterBackgroundStatus,
    enabled: canEdit && !closed,
  });

  const { data: previewBlob } = useQuery({
    queryKey: ["poster-background", jobPosting.id, jobPosting.poster_background_generated_at],
    queryFn: () => getPosterBackgroundBlob(jobPosting.id),
    enabled: jobPosting.has_poster_background,
  });

  useEffect(() => {
    if (!previewBlob) return;
    const url = URL.createObjectURL(previewBlob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewBlob]);

  function fail(fallback: string) {
    return (err: unknown) => setError(err instanceof ApiError ? err.message : fallback);
  }
  function done(message: string) {
    return () => {
      setError(null);
      onChanged();
      toast.success(message);
    };
  }

  const generateCopy = useMutation({
    mutationFn: () => generatePosterCopy(jobPosting.id),
    onSuccess: done("Poster wording drafted. Read it before printing."),
    onError: fail("Could not draft the poster wording"),
  });

  const saveCopy = useMutation({
    mutationFn: () => {
      const bullets = form.bullets.map((b) => b.trim()).filter(Boolean);
      const payload: JobPostingPosterCopyPayload = {
        poster_headline: form.headline.trim() || null,
        poster_pitch: form.pitch.trim() || null,
        poster_bullets: bullets.length > 0 ? bullets : null,
      };
      return updatePosterCopy(jobPosting.id, payload);
    },
    onSuccess: () => {
      setEditOpen(false);
      done("Poster wording saved.")();
    },
    onError: fail("Could not save the poster wording"),
  });

  const generateBackground = useMutation({
    mutationFn: () => generatePosterBackground(jobPosting.id),
    onSuccess: done("Background image drawn. Look at it before switching it on."),
    onError: fail("Could not draw the background image"),
  });

  const switchBackground = useMutation({
    mutationFn: (enabled: boolean) => setPosterBackgroundEnabled(jobPosting.id, enabled),
    onSuccess: (posting) =>
      done(posting.poster_background_enabled ? "The image will be printed on the poster." : "The image will not be printed.")(),
    onError: fail("Could not change the background image"),
  });

  const download = useMutation({
    mutationFn: () => getPosterBlob(jobPosting.id),
    onSuccess: (blob) => {
      setError(null);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${jobPosting.posting_number ?? "job-posting"}-poster.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Poster downloaded.");
    },
    onError: fail("Could not create the poster"),
  });

  function openEdit() {
    setForm(formFrom(jobPosting));
    setError(null);
    setEditOpen(true);
  }

  function setBullet(index: number, value: string) {
    setForm((f) => ({ ...f, bullets: f.bullets.map((b, i) => (i === index ? value : b)) }));
  }

  const copyAiUnavailable = copyAiStatus !== undefined && !copyAiStatus.configured;
  const imageAiUnavailable = imageAiStatus !== undefined && !imageAiStatus.configured;
  const busy = generateCopy.isPending || generateBackground.isPending || switchBackground.isPending;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Recruitment poster</CardTitle>
        <div className="flex flex-wrap gap-2">
          {canDownload ? (
            <Button variant="outline" size="sm" disabled={download.isPending} onClick={() => download.mutate()}>
              {download.isPending ? "Preparing…" : "Download poster (PDF)"}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 text-sm">
        <p className="text-xs text-muted-foreground">
          The A4 poster for a notice board. Everything here is optional — a poster with none of it prints the plain
          template, and nothing here changes the advertisement or its approval.
        </p>
        {error ? <p className="text-destructive">{error}</p> : null}

        {/* --- Wording ---------------------------------------------------- */}
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">Poster wording</h3>
            {canEdit && !closed ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || copyAiUnavailable || !hasSource}
                  onClick={() => generateCopy.mutate()}
                >
                  {generateCopy.isPending ? "Drafting…" : hasCopy ? "Draft again with AI" : "Draft with AI"}
                </Button>
                <Button variant="outline" size="sm" onClick={openEdit}>
                  Edit wording
                </Button>
              </div>
            ) : null}
          </div>

          {canEdit && !closed && !hasSource ? (
            <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Write the job description first. There is nothing for the AI to base poster wording on until the
              advertisement has text.
            </p>
          ) : null}
          {canEdit && !closed && copyAiUnavailable ? (
            <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              AI wording is unavailable: {copyAiStatus?.message}. You can still write the poster wording by hand.
            </p>
          ) : null}

          {hasCopy ? (
            <div className="flex flex-col gap-2 rounded-md border border-border px-3 py-3">
              <div className="text-base font-semibold">{jobPosting.poster_headline ?? "WE ARE HIRING"}</div>
              {jobPosting.poster_pitch ? <p className="text-muted-foreground">{jobPosting.poster_pitch}</p> : null}
              {jobPosting.poster_bullets?.length ? (
                <ul className="ml-4 list-disc text-muted-foreground">
                  {jobPosting.poster_bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
              {jobPosting.poster_copy_generated_at ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="info">AI draft</Badge>
                  Drafted {new Date(jobPosting.poster_copy_generated_at).toLocaleString()}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No poster wording yet. The poster prints “WE ARE HIRING” above the job title.
            </p>
          )}
        </section>

        {/* --- Background image ------------------------------------------- */}
        <section className="flex flex-col gap-3 border-t border-border pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">Background image</h3>
            {canEdit && !closed ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy || imageAiUnavailable}
                onClick={() => generateBackground.mutate()}
              >
                {generateBackground.isPending
                  ? "Drawing…"
                  : jobPosting.has_poster_background
                    ? "Draw a new one"
                    : "Draw with AI"}
              </Button>
            ) : null}
          </div>

          {canEdit && !closed && imageAiUnavailable ? (
            <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {imageAiStatus?.message}. The poster prints its plain header.
            </p>
          ) : null}

          {jobPosting.has_poster_background ? (
            <div className="flex flex-wrap items-start gap-4">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Generated poster background"
                  className="h-24 w-36 rounded-md border border-border object-cover"
                />
              ) : (
                <div className="flex h-24 w-36 items-center justify-center rounded-md border border-border text-xs text-muted-foreground">
                  Loading…
                </div>
              )}
              <div className="flex min-w-0 flex-col gap-2">
                {jobPosting.poster_background_enabled ? (
                  <Badge variant="success">Printed on the poster</Badge>
                ) : (
                  <Badge variant="warning">Not printed yet</Badge>
                )}
                <p className="text-xs text-muted-foreground">
                  {jobPosting.poster_background_enabled
                    ? "This image sits behind the poster's header band."
                    : "Look at it at full size before you switch it on — it will be printed under the SIMATS seal."}
                </p>
                {canEdit && !closed ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={jobPosting.poster_background_enabled ? "outline" : "default"}
                      disabled={busy}
                      onClick={() => switchBackground.mutate(!jobPosting.poster_background_enabled)}
                    >
                      {jobPosting.poster_background_enabled ? "Do not print it" : "Use it on the poster"}
                    </Button>
                    {previewUrl ? (
                      <Button variant="outline" size="sm" asChild>
                        <a href={previewUrl} target="_blank" rel="noreferrer">
                          View full size
                        </a>
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {jobPosting.poster_background_generated_at ? (
                  <p className="text-xs text-muted-foreground">
                    Drawn {new Date(jobPosting.poster_background_generated_at).toLocaleString()}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No background image. The poster prints its plain navy header. A new image is always switched off until
              somebody looks at it.
            </p>
          )}
        </section>
      </CardContent>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit poster wording</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="poster-headline">Headline</Label>
              <Input
                id="poster-headline"
                value={form.headline}
                maxLength={HEADLINE_MAX}
                placeholder="WE ARE HIRING"
                onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Replaces “WE ARE HIRING”. Keep it short — it is printed large.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="poster-pitch">Pitch</Label>
              <Textarea
                id="poster-pitch"
                value={form.pitch}
                maxLength={PITCH_MAX}
                rows={2}
                onChange={(e) => setForm((f) => ({ ...f, pitch: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">One sentence, printed under the campus name.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Highlights</Label>
              {form.bullets.map((bullet, index) => (
                <Input
                  key={index}
                  aria-label={`Highlight ${index + 1}`}
                  value={bullet}
                  onChange={(e) => setBullet(index, e.target.value)}
                />
              ))}
              {form.bullets.length < MAX_BULLETS ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => setForm((f) => ({ ...f, bullets: [...f.bullets, ""] }))}
                >
                  Add a highlight
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">Five is the most the poster can lay out.</p>
              )}
              <p className="text-xs text-muted-foreground">Empty ones are dropped rather than printed as blank rows.</p>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saveCopy.isPending} onClick={() => saveCopy.mutate()}>
              {saveCopy.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
