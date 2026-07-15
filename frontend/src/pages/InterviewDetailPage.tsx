import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { getApplication } from "@/api/applications";
import { getCandidate } from "@/api/candidates";
import { ApiError } from "@/api/client";
import {
  generateInterviewQuestions,
  getInterview,
  listInterviewFeedback,
  submitInterviewFeedback,
  updateInterview,
} from "@/api/interviews";
import type { InterviewQuestionItem, InterviewRecommendation } from "@/api/types";
import { listUsers } from "@/api/users";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge } from "@/components/interviews/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

const WRITE_ROLES = ["RECRUITMENT_OFFICER", "HR_ADMIN", "SUPER_ADMIN"];
const RECOMMENDATIONS: InterviewRecommendation[] = ["STRONG_HIRE", "HIRE", "NO_HIRE", "STRONG_NO_HIRE"];

function toDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function InterviewDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { getLabel } = useJobPostingLookup();

  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editScheduledAt, setEditScheduledAt] = useState("");
  const [editDuration, setEditDuration] = useState("");
  const [editMeetingLink, setEditMeetingLink] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const [technicalScore, setTechnicalScore] = useState("");
  const [communicationScore, setCommunicationScore] = useState("");
  const [researchScore, setResearchScore] = useState("");
  const [teachingDemoScore, setTeachingDemoScore] = useState("");
  const [recommendation, setRecommendation] = useState<InterviewRecommendation | "">("");
  const [comments, setComments] = useState("");
  const [generatedQuestions, setGeneratedQuestions] = useState<InterviewQuestionItem[] | null>(null);

  const { data: interview, isLoading } = useQuery({
    queryKey: ["interview", id],
    queryFn: () => getInterview(id!),
    enabled: Boolean(id),
  });

  const { data: application } = useQuery({
    queryKey: ["application", interview?.application_id],
    queryFn: () => getApplication(interview!.application_id),
    enabled: Boolean(interview),
  });

  const { data: candidate } = useQuery({
    queryKey: ["candidate", application?.candidate_id],
    queryFn: () => getCandidate(application!.candidate_id),
    enabled: Boolean(application),
  });

  const { data: users } = useQuery({ queryKey: ["users"], queryFn: listUsers });

  const { data: feedbackEntries } = useQuery({
    queryKey: ["interview-feedback", id],
    queryFn: () => listInterviewFeedback(id!),
    enabled: Boolean(id),
  });

  function afterAction() {
    void queryClient.invalidateQueries({ queryKey: ["interview", id] });
    void queryClient.invalidateQueries({ queryKey: ["interviews"] });
  }

  const cancelMutation = useMutation({
    mutationFn: () => updateInterview(id!, { status: "CANCELLED" }),
    onSuccess: () => {
      setError(null);
      afterAction();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Cancel failed"),
  });

  const completeMutation = useMutation({
    mutationFn: () => updateInterview(id!, { status: "COMPLETED" }),
    onSuccess: () => {
      setError(null);
      afterAction();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Mark completed failed"),
  });

  const editMutation = useMutation({
    mutationFn: () =>
      updateInterview(id!, {
        scheduled_at: new Date(editScheduledAt).toISOString(),
        duration_minutes: Number(editDuration),
        meeting_link: editMeetingLink || null,
        location: editLocation || null,
        notes: editNotes || null,
      }),
    onSuccess: () => {
      setError(null);
      setEditOpen(false);
      afterAction();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Update failed"),
  });

  const feedbackMutation = useMutation({
    mutationFn: () =>
      submitInterviewFeedback(id!, {
        technical_score: technicalScore ? Number(technicalScore) : null,
        communication_score: communicationScore ? Number(communicationScore) : null,
        research_score: researchScore ? Number(researchScore) : null,
        teaching_demo_score: teachingDemoScore ? Number(teachingDemoScore) : null,
        overall_recommendation: recommendation as InterviewRecommendation,
        comments: comments || null,
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["interview-feedback", id] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Feedback submission failed"),
  });

  const generateQuestionsMutation = useMutation({
    mutationFn: () => generateInterviewQuestions(id!),
    onSuccess: (result) => {
      setError(null);
      setGeneratedQuestions(result.questions);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Question generation failed"),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!interview || !user) {
    return <Navigate to="/interviews" replace />;
  }

  const canWrite = WRITE_ROLES.includes(user.role);
  const canMarkCompleted = canWrite && interview.status === "SCHEDULED";
  const positionLabel = application ? getLabel(application.job_posting_id)?.positionTitle : undefined;

  const panelMembers = interview.panel_member_ids
    .map((memberId) => users?.find((u) => u.id === memberId))
    .filter((member): member is NonNullable<typeof member> => Boolean(member));

  const isAssignedPanelMember =
    (user.role === "INTERVIEW_PANEL_MEMBER" || user.role === "SUPER_ADMIN") &&
    interview.panel_member_ids.includes(user.id);
  const hasSubmittedFeedback = feedbackEntries?.some((f) => f.panel_member_id === user.id) ?? false;
  const canSubmitFeedback = isAssignedPanelMember && !hasSubmittedFeedback;
  const canGenerateQuestions = canWrite || isAssignedPanelMember;

  function openEditDialog() {
    if (!interview) return;
    setEditScheduledAt(toDatetimeLocal(interview.scheduled_at));
    setEditDuration(String(interview.duration_minutes));
    setEditMeetingLink(interview.meeting_link ?? "");
    setEditLocation(interview.location ?? "");
    setEditNotes(interview.notes ?? "");
    setEditOpen(true);
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{interview.interview_type.replace(/_/g, " ")} interview</h1>
          <div className="mt-1">
            <StatusBadge status={interview.status} />
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/interviews">Back to list</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Candidate</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {candidate && application ? (
            <>
              <Link to={`/applications/${application.id}`} className="font-medium hover:underline">
                {candidate.full_name}
              </Link>
              <div className="text-muted-foreground">
                {positionLabel ?? "Unknown position"} · {candidate.email}
              </div>
            </>
          ) : (
            "—"
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Scheduled at</div>
            <div>{new Date(interview.scheduled_at).toLocaleString()}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Duration</div>
            <div>{interview.duration_minutes} minutes</div>
          </div>
          {interview.meeting_link ? (
            <div className="col-span-2">
              <div className="text-muted-foreground">Meeting link</div>
              <div>{interview.meeting_link}</div>
            </div>
          ) : null}
          {interview.location ? (
            <div className="col-span-2">
              <div className="text-muted-foreground">Location</div>
              <div>{interview.location}</div>
            </div>
          ) : null}
          {interview.notes ? (
            <div className="col-span-2">
              <div className="text-muted-foreground">Notes</div>
              <div>{interview.notes}</div>
            </div>
          ) : null}
          <div className="col-span-2">
            <div className="mb-1 text-muted-foreground">Panel</div>
            {panelMembers.length === 0 ? (
              <div>—</div>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {panelMembers.map((member) => (
                  <li key={member.id}>
                    {member.full_name} <span className="text-xs text-muted-foreground">({member.email})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" onClick={openEditDialog}>
                Edit
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reschedule interview</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit_scheduled_at">Scheduled at</Label>
                  <Input
                    id="edit_scheduled_at"
                    type="datetime-local"
                    value={editScheduledAt}
                    onChange={(e) => setEditScheduledAt(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit_duration">Duration (minutes)</Label>
                  <Input
                    id="edit_duration"
                    type="number"
                    min={1}
                    value={editDuration}
                    onChange={(e) => setEditDuration(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit_meeting_link">Meeting link</Label>
                  <Input
                    id="edit_meeting_link"
                    value={editMeetingLink}
                    onChange={(e) => setEditMeetingLink(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit_location">Location</Label>
                  <Input id="edit_location" value={editLocation} onChange={(e) => setEditLocation(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit_notes">Notes</Label>
                  <Textarea id="edit_notes" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button disabled={editMutation.isPending} onClick={() => editMutation.mutate()}>
                  {editMutation.isPending ? "Saving…" : "Save changes"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {canMarkCompleted ? (
            <Button disabled={completeMutation.isPending} onClick={() => completeMutation.mutate()}>
              {completeMutation.isPending ? "Marking…" : "Mark completed"}
            </Button>
          ) : null}

          <Button
            variant="destructive"
            disabled={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
          >
            {cancelMutation.isPending ? "Cancelling…" : "Cancel"}
          </Button>
        </div>
      ) : null}

      {canGenerateQuestions ? (
        <Card>
          <CardHeader>
            <CardTitle>Interview Questions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={generateQuestionsMutation.isPending}
              onClick={() => generateQuestionsMutation.mutate()}
            >
              {generateQuestionsMutation.isPending ? "Generating…" : "Generate interview questions"}
            </Button>
            {generatedQuestions ? (
              generatedQuestions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No questions were generated.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {generatedQuestions.map((q, index) => (
                    <li key={index} className="rounded-md border border-border p-3">
                      <div className="text-xs font-medium text-muted-foreground">{q.category}</div>
                      <div>{q.question}</div>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Feedback</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canSubmitFeedback ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                feedbackMutation.mutate();
              }}
              className="flex flex-col gap-3 rounded-md border border-border p-3"
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="technical_score">Technical score (1-10)</Label>
                  <Input
                    id="technical_score"
                    type="number"
                    min={1}
                    max={10}
                    value={technicalScore}
                    onChange={(e) => setTechnicalScore(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="communication_score">Communication score (1-10)</Label>
                  <Input
                    id="communication_score"
                    type="number"
                    min={1}
                    max={10}
                    value={communicationScore}
                    onChange={(e) => setCommunicationScore(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="research_score">Research score (1-10)</Label>
                  <Input
                    id="research_score"
                    type="number"
                    min={1}
                    max={10}
                    value={researchScore}
                    onChange={(e) => setResearchScore(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="teaching_demo_score">Teaching demo score (1-10)</Label>
                  <Input
                    id="teaching_demo_score"
                    type="number"
                    min={1}
                    max={10}
                    value={teachingDemoScore}
                    onChange={(e) => setTeachingDemoScore(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Overall recommendation</Label>
                <Select
                  value={recommendation}
                  onValueChange={(v) => setRecommendation(v as InterviewRecommendation)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a recommendation" />
                  </SelectTrigger>
                  <SelectContent>
                    {RECOMMENDATIONS.map((rec) => (
                      <SelectItem key={rec} value={rec}>
                        {rec.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="comments">Comments (optional)</Label>
                <Textarea id="comments" value={comments} onChange={(e) => setComments(e.target.value)} />
              </div>
              <Button type="submit" disabled={!recommendation || feedbackMutation.isPending} className="w-fit">
                {feedbackMutation.isPending ? "Submitting…" : "Submit feedback"}
              </Button>
            </form>
          ) : null}

          {!feedbackEntries || feedbackEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No feedback submitted yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {feedbackEntries.map((feedback) => {
                const member = users?.find((u) => u.id === feedback.panel_member_id);
                return (
                  <li key={feedback.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="font-medium">{member?.full_name ?? "Unknown panel member"}</div>
                    <div className="text-muted-foreground">
                      Recommendation: {feedback.overall_recommendation.replace(/_/g, " ")}
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-x-4 text-xs text-muted-foreground">
                      <div>Technical: {feedback.technical_score ?? "—"}</div>
                      <div>Communication: {feedback.communication_score ?? "—"}</div>
                      <div>Research: {feedback.research_score ?? "—"}</div>
                      <div>Teaching demo: {feedback.teaching_demo_score ?? "—"}</div>
                    </div>
                    {feedback.comments ? <div className="mt-2">{feedback.comments}</div> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
