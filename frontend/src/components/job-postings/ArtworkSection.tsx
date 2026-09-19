import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { JobPostingRead } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Every wording that differs between the two pictures a poster can carry.
// Kept as data so the behaviour -- draw, look, switch on -- is written once,
// mirroring the backend's single _Artwork spec in services/job_postings.py.
export interface ArtworkLabels {
  title: string;
  alt: string;
  draw: string;
  redraw: string;
  use: string;
  stop: string;
  approvedHint: string;
  pendingHint: string;
  empty: string;
  unavailableSuffix: string;
  drawnToast: string;
  enabledToast: string;
  disabledToast: string;
  drawFailed: string;
  switchFailed: string;
}

interface ArtworkSectionProps {
  jobPostingId: string;
  exists: boolean;
  enabled: boolean;
  generatedAt: string | null;
  // canEdit && the posting is not closed.
  editable: boolean;
  // Another poster action is in flight; don't start a second one.
  disabled: boolean;
  imageAiUnavailable: boolean;
  imageAiMessage: string | null | undefined;
  previewQueryKey: string;
  getBlob: (id: string) => Promise<Blob>;
  generate: (id: string) => Promise<JobPostingRead>;
  setEnabled: (id: string, enabled: boolean) => Promise<JobPostingRead>;
  labels: ArtworkLabels;
  onDone: (message: string) => void;
  onError: (fallback: string) => (err: unknown) => void;
}

export function ArtworkSection({
  jobPostingId,
  exists,
  enabled,
  generatedAt,
  editable,
  disabled,
  imageAiUnavailable,
  imageAiMessage,
  previewQueryKey,
  getBlob,
  generate,
  setEnabled,
  labels,
  onDone,
  onError,
}: ArtworkSectionProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const { data: previewBlob } = useQuery({
    queryKey: [previewQueryKey, jobPostingId, generatedAt],
    queryFn: () => getBlob(jobPostingId),
    enabled: exists,
  });

  useEffect(() => {
    if (!previewBlob) return;
    const url = URL.createObjectURL(previewBlob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewBlob]);

  const draw = useMutation({
    mutationFn: () => generate(jobPostingId),
    onSuccess: () => onDone(labels.drawnToast),
    onError: onError(labels.drawFailed),
  });

  const toggle = useMutation({
    mutationFn: (value: boolean) => setEnabled(jobPostingId, value),
    onSuccess: (_posting, value) => onDone(value ? labels.enabledToast : labels.disabledToast),
    onError: onError(labels.switchFailed),
  });

  const busy = disabled || draw.isPending || toggle.isPending;

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{labels.title}</h3>
        {editable ? (
          <Button variant="outline" size="sm" disabled={busy || imageAiUnavailable} onClick={() => draw.mutate()}>
            {draw.isPending ? "Drawing… (about a minute)" : exists ? labels.redraw : labels.draw}
          </Button>
        ) : null}
      </div>

      {editable && imageAiUnavailable ? (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {imageAiMessage}. {labels.unavailableSuffix}
        </p>
      ) : null}

      {exists ? (
        <div className="flex flex-wrap items-start gap-4">
          {previewUrl ? (
            <img src={previewUrl} alt={labels.alt} className="h-24 w-36 rounded-md border border-border object-cover" />
          ) : (
            <div className="flex h-24 w-36 items-center justify-center rounded-md border border-border text-xs text-muted-foreground">
              Loading…
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-2">
            {enabled ? (
              <Badge variant="success">Printed on the poster</Badge>
            ) : (
              <Badge variant="warning">Not printed yet</Badge>
            )}
            <p className="text-xs text-muted-foreground">{enabled ? labels.approvedHint : labels.pendingHint}</p>
            {editable ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={enabled ? "outline" : "default"}
                  disabled={busy}
                  onClick={() => toggle.mutate(!enabled)}
                >
                  {enabled ? labels.stop : labels.use}
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
            {generatedAt ? (
              <p className="text-xs text-muted-foreground">Drawn {new Date(generatedAt).toLocaleString()}</p>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{labels.empty}</p>
      )}
    </section>
  );
}
