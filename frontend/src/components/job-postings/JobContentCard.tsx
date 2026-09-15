import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { generateJobPostingContent, getContentGenerationStatus, updateJobPosting } from "@/api/jobPostings";
import { listLocations } from "@/api/locations";
import type { EmploymentType, JobPostingRead, JobPostingUpdatePayload } from "@/api/types";
import { DetailItem } from "@/components/job-postings/DetailItem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { formatEmploymentType } from "@/lib/careersDisplay";
import { compareLocationsForDisplay, locationLabel } from "@/lib/locationDisplay";

// Mirrors app/models/enums.py::EmploymentTypeEnum.
const EMPLOYMENT_TYPES: EmploymentType[] = ["FULL_TIME", "PART_TIME", "CONTRACT", "VISITING", "ADJUNCT", "TRA", "JRF"];
// Radix Select cannot hold an empty-string value.
const NONE = "__none__";

interface ContentForm {
  title: string;
  summary: string;
  description: string;
  responsibilities: string;
  qualification: string;
  experience: string;
  requiredSkills: string;
  preferredSkills: string;
  employmentType: EmploymentType | "";
  locationId: string;
  salaryMin: string;
  salaryMax: string;
  applyDeadline: string;
  contactEmail: string;
}

function formFrom(posting: JobPostingRead): ContentForm {
  return {
    title: posting.ad_title ?? posting.position_title,
    summary: posting.summary ?? "",
    description: posting.ad_body ?? "",
    responsibilities: posting.responsibilities ?? "",
    qualification: posting.required_qualification ?? "",
    experience: posting.required_experience ?? "",
    requiredSkills: (posting.required_skills ?? []).join(", "),
    preferredSkills: (posting.preferred_skills ?? []).join(", "),
    employmentType: posting.employment_type ?? "",
    locationId: posting.location_id ?? "",
    salaryMin: posting.salary_min == null ? "" : String(posting.salary_min),
    salaryMax: posting.salary_max == null ? "" : String(posting.salary_max),
    applyDeadline: posting.apply_deadline ?? "",
    contactEmail: posting.contact_email ?? "",
  };
}

function splitList(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function salaryRange(min: number | null, max: number | null): string | null {
  const money = (value: number) => `₹${value.toLocaleString("en-IN")}`;
  if (min != null && max != null) return `${money(min)} – ${money(max)}`;
  if (min != null) return `From ${money(min)}`;
  if (max != null) return `Up to ${money(max)}`;
  return null;
}

function Chips({ items }: { items: string[] | null }) {
  if (!items || items.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((item) => (
        <Badge key={item} variant="outline">
          {item}
        </Badge>
      ))}
    </span>
  );
}

interface JobContentCardProps {
  jobPosting: JobPostingRead;
  canEdit: boolean;
  onChanged: () => void;
}

/** Section B: the job content, its editor, and the AI draft. AI only ever
 * fills a DRAFT posting's text; the approved requirements are left alone. */
export function JobContentCard({ jobPosting, canEdit, onChanged }: JobContentCardProps) {
  const toast = useToast();
  const closed = jobPosting.status === "CLOSED";
  const isDraft = jobPosting.status === "DRAFT";
  const underReview = jobPosting.status === "READY_FOR_REVIEW" || jobPosting.status === "APPROVED";

  const [editOpen, setEditOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [form, setForm] = useState<ContentForm>(() => formFrom(jobPosting));
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: aiStatus } = useQuery({
    queryKey: ["content-generation-status"],
    queryFn: getContentGenerationStatus,
    enabled: canEdit && isDraft,
  });
  const { data: locations } = useQuery({ queryKey: ["locations"], queryFn: listLocations, enabled: editOpen });
  const campusLocations = (locations ?? [])
    .filter((l) => l.campus_id === jobPosting.campus_id && (l.is_active || l.id === jobPosting.location_id))
    .sort(compareLocationsForDisplay);

  function set<K extends keyof ContentForm>(key: K, value: ContentForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function payload(): JobPostingUpdatePayload {
    return {
      ad_title: form.title.trim(),
      ad_body: form.description.trim(),
      summary: form.summary.trim() || null,
      responsibilities: form.responsibilities.trim() || null,
      required_qualification: form.qualification.trim() || null,
      required_experience: form.experience.trim() || null,
      required_skills: splitList(form.requiredSkills),
      preferred_skills: splitList(form.preferredSkills),
      employment_type: form.employmentType || null,
      location_id: form.locationId || null,
      salary_min: form.salaryMin === "" ? null : Number(form.salaryMin),
      salary_max: form.salaryMax === "" ? null : Number(form.salaryMax),
      apply_deadline: form.applyDeadline || null,
      contact_email: form.contactEmail.trim() || null,
    };
  }

  const save = useMutation({
    mutationFn: () => updateJobPosting(jobPosting.id, payload()),
    onSuccess: (updated) => {
      setEditOpen(false);
      onChanged();
      toast.success(updated.status === "DRAFT" && underReview ? "Saved. The posting is back in draft for review." : "Job content saved.");
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save the job content"),
  });
  const generate = useMutation({
    mutationFn: () => generateJobPostingContent(jobPosting.id, instructions.trim() || null),
    onSuccess: () => {
      setAiOpen(false);
      setInstructions("");
      onChanged();
      toast.success("AI draft written. Review and edit it before submitting.");
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "AI drafting failed"),
  });

  function openEdit() {
    setForm(formFrom(jobPosting));
    setError(null);
    setEditOpen(true);
  }

  function submitEdit() {
    const min = form.salaryMin === "" ? null : Number(form.salaryMin);
    const max = form.salaryMax === "" ? null : Number(form.salaryMax);
    if ((min != null && (Number.isNaN(min) || min < 0)) || (max != null && (Number.isNaN(max) || max < 0))) {
      setError("Salary must be a positive number.");
      return;
    }
    if (min != null && max != null && min > max) {
      setError("Salary from cannot be more than salary to.");
      return;
    }
    setError(null);
    save.mutate();
  }

  const aiUnavailable = aiStatus !== undefined && !aiStatus.configured;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Job description</CardTitle>
        <div className="flex flex-wrap gap-2">
          {jobPosting.ad_body ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(jobPosting.ad_body ?? "");
                toast.success("Job description copied.");
              }}
            >
              Copy description
            </Button>
          ) : null}
          {canEdit && isDraft ? (
            <Button variant="outline" size="sm" disabled={aiUnavailable} onClick={() => setAiOpen(true)}>
              Generate with AI
            </Button>
          ) : null}
          {canEdit && !closed ? (
            <Button variant="outline" size="sm" onClick={openEdit}>
              Edit
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        {canEdit && isDraft ? (
          aiUnavailable ? (
            <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              AI drafting is not configured on this server ({aiStatus?.message}). Write the content by hand; everything
              else works without it.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">AI writes a draft only. Review and edit it before submitting for review.</p>
          )
        ) : null}
        {error && !editOpen && !aiOpen ? <p className="text-destructive">{error}</p> : null}

        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <DetailItem label="Job title">{jobPosting.ad_title ?? jobPosting.position_title}</DetailItem>
          </div>
          <div className="sm:col-span-2">
            <DetailItem label="Summary">{jobPosting.summary}</DetailItem>
          </div>
          <div className="sm:col-span-2">
            <DetailItem label="Description">
              {jobPosting.ad_body ? (
                <span className="block whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs">
                  {jobPosting.ad_body}
                </span>
              ) : null}
            </DetailItem>
            {jobPosting.ai_generated_at ? (
              <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="info">AI draft</Badge>
                Generated {new Date(jobPosting.ai_generated_at).toLocaleString()}
              </p>
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <DetailItem label="Responsibilities">
              {jobPosting.responsibilities ? <span className="whitespace-pre-wrap">{jobPosting.responsibilities}</span> : null}
            </DetailItem>
          </div>
          <DetailItem label="Required qualification">{jobPosting.required_qualification}</DetailItem>
          <DetailItem label="Required experience">{jobPosting.required_experience}</DetailItem>
          <DetailItem label="Required skills">
            <Chips items={jobPosting.required_skills} />
          </DetailItem>
          <DetailItem label="Preferred skills">
            <Chips items={jobPosting.preferred_skills} />
          </DetailItem>
          <DetailItem label="Salary / pay range">{salaryRange(jobPosting.salary_min, jobPosting.salary_max)}</DetailItem>
        </dl>
      </CardContent>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit job content</DialogTitle>
          </DialogHeader>
          {underReview ? (
            <p className="rounded-md border border-brand-caution/40 bg-brand-caution/10 px-3 py-2 text-xs">
              This posting is {jobPosting.status === "APPROVED" ? "approved" : "in review"}. Saving a change sends it back
              to draft, to be reviewed again.
            </p>
          ) : null}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="job_title">Job title</Label>
              <Input id="job_title" value={form.title} maxLength={200} onChange={(e) => set("title", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="job_summary">Summary</Label>
              <Textarea id="job_summary" rows={2} maxLength={2000} value={form.summary} onChange={(e) => set("summary", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="job_description">Job description</Label>
              <Textarea id="job_description" rows={8} value={form.description} onChange={(e) => set("description", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="job_responsibilities">Responsibilities</Label>
              <Textarea
                id="job_responsibilities"
                rows={4}
                value={form.responsibilities}
                onChange={(e) => set("responsibilities", e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="job_qualification">Required qualification</Label>
                <Input id="job_qualification" value={form.qualification} onChange={(e) => set("qualification", e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="job_experience">Required experience</Label>
                <Input id="job_experience" maxLength={100} value={form.experience} onChange={(e) => set("experience", e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="job_required_skills">Required skills</Label>
                <Input
                  id="job_required_skills"
                  placeholder="Comma separated"
                  value={form.requiredSkills}
                  onChange={(e) => set("requiredSkills", e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="job_preferred_skills">Preferred skills</Label>
                <Input
                  id="job_preferred_skills"
                  placeholder="Comma separated"
                  value={form.preferredSkills}
                  onChange={(e) => set("preferredSkills", e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Employment type</Label>
                <Select
                  value={form.employmentType || NONE}
                  onValueChange={(v) => set("employmentType", v === NONE ? "" : (v as EmploymentType))}
                >
                  <SelectTrigger aria-label="Employment type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not specified</SelectItem>
                    {EMPLOYMENT_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {formatEmploymentType(type)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Location</Label>
                <Select value={form.locationId || NONE} onValueChange={(v) => set("locationId", v === NONE ? "" : v)}>
                  <SelectTrigger aria-label="Location">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not specified</SelectItem>
                    {campusLocations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {locationLabel(location)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="job_salary_min">Salary from (₹, optional)</Label>
                <Input id="job_salary_min" type="number" min={0} value={form.salaryMin} onChange={(e) => set("salaryMin", e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="job_salary_max">Salary to (₹, optional)</Label>
                <Input id="job_salary_max" type="number" min={0} value={form.salaryMax} onChange={(e) => set("salaryMax", e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="job_apply_deadline">Application deadline</Label>
                <Input id="job_apply_deadline" type="date" value={form.applyDeadline} onChange={(e) => set("applyDeadline", e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="job_contact_email">Contact email</Label>
                <Input id="job_contact_email" type="email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />
              </div>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button disabled={save.isPending || !form.title.trim() || !form.description.trim()} onClick={submitEdit}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate a draft with AI</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Writes a new summary, responsibilities, preferred skills and description from the approved requirements. It
            replaces those four fields and nothing else. The result is a draft for you to edit.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai_instructions">Instructions (optional)</Label>
            <Textarea
              id="ai_instructions"
              rows={3}
              maxLength={2000}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>
          {error && aiOpen ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAiOpen(false)}>
              Cancel
            </Button>
            <Button disabled={generate.isPending} onClick={() => generate.mutate()}>
              {generate.isPending ? "Generating…" : "Generate draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
