import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { listApplications } from "@/api/applications";
import { listCandidates } from "@/api/candidates";
import { ApiError } from "@/api/client";
import { createInterview } from "@/api/interviews";
import type { ApplicationRead, InterviewType } from "@/api/types";
import { listUsers } from "@/api/users";
import { useAuth } from "@/auth/AuthContext";
import { ApplicationPicker } from "@/components/interviews/ApplicationPicker";
import { PanelMemberPicker } from "@/components/interviews/PanelMemberPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { required, useFieldValidation } from "@/hooks/useFieldValidation";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

const CAN_CREATE_ROLES = ["RECRUITMENT_OFFICER", "HR_ADMIN", "SUPER_ADMIN", "RECRUITMENT_COORDINATOR"];
const INTERVIEW_TYPES: InterviewType[] = ["TECHNICAL", "HR", "TEACHING_DEMO", "GENERAL"];

export function InterviewCreatePage() {
  const { user, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedApplicationId = searchParams.get("application_id");

  const { data: applications } = useQuery({ queryKey: ["applications", {}], queryFn: () => listApplications() });
  const { data: candidates } = useQuery({ queryKey: ["candidates", ""], queryFn: () => listCandidates() });
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const { getLabel } = useJobPostingLookup();

  const preselected = preselectedApplicationId
    ? (applications?.find((a) => a.id === preselectedApplicationId) ?? null)
    : null;

  const [application, setApplication] = useState<ApplicationRead | null>(null);
  const selectedApplication = preselectedApplicationId ? preselected : application;

  const [interviewType, setInterviewType] = useState<InterviewType>("TECHNICAL");
  const scheduledAt = useFieldValidation("", required("Scheduled time is required"));
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [meetingLink, setMeetingLink] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [panelMemberIds, setPanelMemberIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const panelCandidates = (users ?? []).filter(
    (u) => u.role === "INTERVIEW_PANEL_MEMBER" && u.campus_id === selectedApplication?.campus_id,
  );

  function getCandidateLabel(candidateId: string) {
    const candidate = candidates?.find((c) => c.id === candidateId);
    return candidate ? { full_name: candidate.full_name, email: candidate.email } : undefined;
  }

  const mutation = useMutation({
    mutationFn: () =>
      createInterview({
        application_id: selectedApplication!.id,
        interview_type: interviewType,
        scheduled_at: new Date(scheduledAt.value).toISOString(),
        duration_minutes: Number(durationMinutes),
        meeting_link: meetingLink || null,
        location: location || null,
        notes: notes || null,
        panel_member_ids: panelMemberIds,
      }),
    onSuccess: (result) => navigate(`/interviews/${result.id}`),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Something went wrong"),
  });

  // Bug fix: OR'd with hasPermission("SCHEDULE_INTERVIEW") -- create_interview
  // is gated by require_permission(SCHEDULE_INTERVIEW), not this role list
  // alone (same pattern as UsersListPage's canManage).
  if (!user || !(CAN_CREATE_ROLES.includes(user.role) || hasPermission?.("SCHEDULE_INTERVIEW"))) {
    return (
      <p className="text-sm text-muted-foreground">
        Only a Recruitment Officer, HR Admin, Super Admin, or Recruitment Coordinator can schedule an interview.
      </p>
    );
  }

  const candidateLabel = selectedApplication ? getCandidateLabel(selectedApplication.candidate_id) : undefined;
  const positionLabel = selectedApplication ? getLabel(selectedApplication.job_posting_id)?.positionTitle : undefined;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Schedule interview</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!scheduledAt.validate()) return;
          mutation.mutate();
        }}
        className="flex max-w-lg flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label>Application</Label>
          {preselectedApplicationId ? (
            <p className="text-sm">
              <span className="font-medium">{candidateLabel?.full_name ?? "Unknown candidate"}</span>{" "}
              <span className="text-muted-foreground">for {positionLabel ?? "Unknown position"}</span>
            </p>
          ) : (
            <ApplicationPicker
              applications={applications ?? []}
              getCandidateLabel={getCandidateLabel}
              value={application}
              onChange={setApplication}
            />
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Interview type</Label>
          <Select value={interviewType} onValueChange={(v) => setInterviewType(v as InterviewType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTERVIEW_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="scheduled_at">Scheduled at</Label>
          <Input
            id="scheduled_at"
            type="datetime-local"
            required
            value={scheduledAt.value}
            onChange={(e) => scheduledAt.onChange(e.target.value)}
            onBlur={scheduledAt.onBlur}
            aria-invalid={Boolean(scheduledAt.error)}
          />
          {scheduledAt.error ? <p className="text-xs text-destructive">{scheduledAt.error}</p> : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="duration_minutes">Duration (minutes)</Label>
          <Input
            id="duration_minutes"
            type="number"
            min={1}
            required
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="meeting_link">Meeting link (optional)</Label>
          <Input id="meeting_link" value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="location">Location (optional)</Label>
          <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Panel members</Label>
          {selectedApplication ? (
            <PanelMemberPicker candidates={panelCandidates} value={panelMemberIds} onChange={setPanelMemberIds} />
          ) : (
            <p className="text-sm text-muted-foreground">Select an application first.</p>
          )}
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Button
          type="submit"
          disabled={mutation.isPending || !selectedApplication || !scheduledAt.value || panelMemberIds.length === 0}
        >
          {mutation.isPending ? "Scheduling…" : "Schedule interview"}
        </Button>
      </form>
    </div>
  );
}
