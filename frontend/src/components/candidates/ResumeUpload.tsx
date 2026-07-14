import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { ApiError } from "@/api/client";
import { downloadResume, uploadResume } from "@/api/candidates";
import type { CandidateRead } from "@/api/types";
import { Button } from "@/components/ui/button";

export function ResumeUpload({ candidate }: { candidate: CandidateRead }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadResume(candidate.id, file),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["candidate", candidate.id] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Upload failed"),
  });

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    event.target.value = "";
  }

  async function handleDownload() {
    if (!candidate.resume_storage_key) return;
    setDownloadError(null);
    setDownloading(true);
    try {
      const filename = candidate.resume_storage_key.split("/").pop() ?? "resume.pdf";
      await downloadResume(candidate.id, filename);
    } catch (err) {
      setDownloadError(err instanceof ApiError ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {candidate.resume_storage_key ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{candidate.resume_storage_key.split("/").pop()}</span>
          <Button variant="outline" size="sm" disabled={downloading} onClick={() => void handleDownload()}>
            {downloading ? "Downloading…" : "Download"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No resume uploaded yet.</p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleFileChange}
      />
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={uploadMutation.isPending}
        onClick={() => fileInputRef.current?.click()}
      >
        {uploadMutation.isPending
          ? "Uploading…"
          : candidate.resume_storage_key
            ? "Replace resume"
            : "Upload resume"}
      </Button>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {downloadError ? <p className="text-sm text-destructive">{downloadError}</p> : null}
    </div>
  );
}
