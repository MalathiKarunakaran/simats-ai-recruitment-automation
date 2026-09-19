import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { getCampaignPosterBlob } from "@/api/campaignPosters";
import { ApiError } from "@/api/client";
import { listJobPostings } from "@/api/jobPostings";
import type { JobPostingRead } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

// Mirrors app/api/v1/routers/campaign_posters.py: at most six roles, all
// PUBLISHED, all one campus (the sheet carries one campus's logo, address
// and QR code). The backend re-checks every one of these.
const MAX_ROLES = 6;
const TITLE_MAX = 60;
const PITCH_MAX = 160;

function RolePhotoBadge({ posting }: { posting: JobPostingRead }) {
  if (posting.role_photo_enabled) return <Badge variant="success">Photo on</Badge>;
  if (posting.has_role_photo) return <Badge variant="warning">Photo not approved</Badge>;
  return <Badge>No photo</Badge>;
}

export function CampaignPosterPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  // Mirrors the router's _poster_gate: JOB_DISTRIBUTION.
  const canPrint = hasPermission?.("JOB_DISTRIBUTION") ?? false;

  const { data: jobPostings, isLoading } = useQuery({
    queryKey: ["job-postings"],
    queryFn: listJobPostings,
    enabled: canPrint,
  });

  const [campusId, setCampusId] = useState<string>("");
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [pitch, setPitch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const published = (jobPostings ?? []).filter((jp) => jp.status === "PUBLISHED");
  const campuses = [...new Map(published.map((jp) => [jp.campus_id, jp])).values()]
    .map((jp) => ({ id: jp.campus_id, code: jp.campus_code, name: jp.campus_name }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const roles = published
    .filter((jp) => jp.campus_id === campusId)
    .sort((a, b) => a.position_title.localeCompare(b.position_title));

  const download = useMutation({
    mutationFn: () =>
      getCampaignPosterBlob(selected, { title: title.trim() || undefined, pitch: pitch.trim() || undefined }),
    onSuccess: (blob) => {
      setError(null);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const code = campuses.find((c) => c.id === campusId)?.code ?? "campus";
      link.download = `${code.toLowerCase()}-campaign-poster.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Campaign poster downloaded.");
    },
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : "Could not create the poster"),
  });

  function chooseCampus(id: string) {
    setCampusId(id);
    // A sheet is one campus: roles ticked under another would be refused.
    setSelected([]);
    setError(null);
  }

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  if (!canPrint) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-lg font-semibold">Campaign poster</h1>
        <p className="text-sm text-muted-foreground">Printing posters needs the job distribution permission.</p>
      </div>
    );
  }

  const full = selected.length >= MAX_ROLES;
  const withoutPhoto = roles.filter((jp) => selected.includes(jp.id) && !jp.role_photo_enabled).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Campaign poster</h1>
        <p className="text-sm text-muted-foreground">
          One A4 sheet advertising several open positions at one campus, in the campus's own house style. The QR code
          opens the public careers page.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Campus</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : campuses.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No published job postings yet. A poster's QR code opens the public apply page, so only published postings
              can be printed.
            </p>
          ) : (
            <div className="w-72">
              <Select value={campusId} onValueChange={chooseCampus}>
                <SelectTrigger aria-label="Campus">
                  <SelectValue placeholder="Choose a campus" />
                </SelectTrigger>
                <SelectContent>
                  {campuses.map((campus) => (
                    <SelectItem key={campus.id} value={campus.id}>
                      {campus.code} — {campus.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {campusId ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>2. Positions</CardTitle>
            <span className="text-sm text-muted-foreground">
              {selected.length} of at most {MAX_ROLES} chosen
            </span>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {roles.map((jp) => {
              const checked = selected.includes(jp.id);
              return (
                <div
                  key={jp.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                >
                  <label className="flex min-w-0 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-input accent-primary"
                      checked={checked}
                      disabled={!checked && full}
                      onChange={() => toggle(jp.id)}
                    />
                    <span className="min-w-0">
                      <span className="font-medium">{jp.position_title}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {jp.department_name}
                        {jp.posting_number ? ` · ${jp.posting_number}` : ""}
                      </span>
                    </span>
                  </label>
                  <div className="flex items-center gap-2">
                    <RolePhotoBadge posting={jp} />
                    <Link to={`/job-postings/${jp.id}`} className="text-xs text-primary hover:underline">
                      Open posting
                    </Link>
                  </div>
                </div>
              );
            })}
            {full ? (
              <p className="text-xs text-muted-foreground">Six is the most one sheet can lay out.</p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              A role's photo is drawn and approved on its own posting, under Recruitment poster. A role without an
              approved photo prints without a picture.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {campusId ? (
        <Card>
          <CardHeader>
            <CardTitle>3. Wording and print</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campaign-title">Ribbon title</Label>
              <Input
                id="campaign-title"
                value={title}
                maxLength={TITLE_MAX}
                placeholder="We are hiring"
                onChange={(e) => setTitle(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">For example “Join our maintenance team”. Printed large.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campaign-pitch">Pitch (optional)</Label>
              <Textarea
                id="campaign-pitch"
                value={pitch}
                maxLength={PITCH_MAX}
                rows={2}
                onChange={(e) => setPitch(e.target.value)}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={selected.length === 0 || download.isPending} onClick={() => download.mutate()}>
                {download.isPending ? "Preparing…" : "Download poster (PDF)"}
              </Button>
              {withoutPhoto > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {withoutPhoto} of the chosen {withoutPhoto === 1 ? "role has" : "roles have"} no approved photo.
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
