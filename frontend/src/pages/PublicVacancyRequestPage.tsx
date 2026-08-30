import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";

import { ApiError } from "@/api/client";
import {
  getPublicFormOptions,
  submitPublicVacancyRequest,
  type PublicVacancyRequestConfirmation,
} from "@/api/publicVacancyRequests";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { locationLabel } from "@/lib/locationDisplay";

// The public, unauthenticated vacancy-request form reached by scanning the QR
// code (2026-08-30). Mounted OUTSIDE ProtectedRoute and outside AppShell, so
// it renders no navigation, no campus switcher and no link back into the
// authenticated app -- a visitor here should not learn that the rest of the
// application exists, let alone be invited into it.
//
// Mobile-first: a single column, large touch targets, no table or drawer. It
// is reached by phone camera, so a desktop-shaped layout would be the wrong
// default.

const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
const NONE = "NONE";

/** Mirrors the backend's own bounds (PublicVacancyRequestCreate). Kept in step
 * deliberately so the form refuses locally what the server would refuse
 * anyway, instead of letting someone fill in a long form and lose it to a
 * 422. The server remains authoritative. */
const MAX_POSITIONS = 100;
const MIN_JUSTIFICATION = 10;

export function PublicVacancyRequestPage() {
  const [campusId, setCampusId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [positions, setPositions] = useState("1");
  const [priority, setPriority] = useState<string>("NORMAL");
  const [requiredBy, setRequiredBy] = useState("");
  const [justification, setJustification] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [requesterEmail, setRequesterEmail] = useState("");
  const [requesterMobile, setRequesterMobile] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PublicVacancyRequestConfirmation | null>(null);

  // Refetched per campus so Department and Location narrow as soon as a campus
  // is picked -- the same cascade the authenticated forms use.
  const { data: options, isLoading } = useQuery({
    queryKey: ["public-form-options", campusId],
    queryFn: () => getPublicFormOptions(campusId || null),
  });

  const departments = options?.departments ?? [];
  const designations = options?.designations ?? [];
  const locations = useMemo(
    () => [...(options?.locations ?? [])].sort((a, b) => locationLabel(a).localeCompare(locationLabel(b))),
    [options?.locations],
  );

  const trimmedPositions = positions.trim();
  const positionsNumber = Number(trimmedPositions);
  const isPositionsValid =
    /^\d+$/.test(trimmedPositions) && positionsNumber >= 1 && positionsNumber <= MAX_POSITIONS;
  const isJustificationValid = justification.trim().length >= MIN_JUSTIFICATION;
  const canSubmit =
    Boolean(campusId && departmentId && designationId) &&
    isPositionsValid &&
    isJustificationValid &&
    requesterName.trim().length >= 2 &&
    requesterEmail.trim().length > 0 &&
    requesterMobile.trim().length >= 6;

  const mutation = useMutation({
    mutationFn: () =>
      submitPublicVacancyRequest({
        campus_id: campusId,
        department_id: departmentId,
        designation_id: designationId,
        location_id: locationId || null,
        number_of_positions: positionsNumber,
        priority,
        required_by: requiredBy || null,
        justification: justification.trim(),
        requester_name: requesterName.trim(),
        requester_email: requesterEmail.trim(),
        requester_mobile: requesterMobile.trim(),
      }),
    onSuccess: (data) => setConfirmation(data),
    // The server's message is shown verbatim rather than replaced with a
    // generic one: its refusals are specific and actionable ("Only 0 posts
    // available to request for this designation"), and hiding that behind
    // "Something went wrong" would leave the requester with no next step.
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not submit this request."),
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || mutation.isPending) return;
    setError(null);
    mutation.mutate();
  }

  if (confirmation) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-4 py-10">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-brand-success" aria-hidden />
            <h1 className="text-xl font-bold text-foreground">Request submitted successfully</h1>
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Request ID</p>
              {/* The one thing worth quoting when chasing this request. It is
                  deliberately the only identifier shown -- the record's real
                  id is never sent to a public submitter. */}
              <p className="font-mono text-2xl font-bold text-foreground">{confirmation.request_ref}</p>
            </div>
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Status</p>
              <p className="text-base font-semibold text-foreground">Pending Approval</p>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Please note this Request ID. Your request has gone to the Dean for review.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      <header className="mb-6 text-center">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">SIMATS Recruitment</p>
        <h1 className="font-display text-2xl font-bold text-foreground">Vacancy Request</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Submit a staffing requirement for your department. You will get a Request ID to track it.
        </p>
      </header>

      <Card>
        <CardContent className="p-5">
          <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
            <div className="flex flex-col gap-1.5">
              <Label>Campus</Label>
              <Select
                value={campusId}
                onValueChange={(value) => {
                  setCampusId(value);
                  // Department and Location are campus-scoped, so a campus
                  // change must clear them -- otherwise a stale selection is
                  // submitted and refused server-side for a reason the
                  // requester cannot see on screen.
                  setDepartmentId("");
                  setLocationId("");
                }}
              >
                <SelectTrigger aria-label="Campus">
                  <SelectValue placeholder={isLoading ? "Loading..." : "Select a campus"} />
                </SelectTrigger>
                <SelectContent>
                  {(options?.campuses ?? []).map((campus) => (
                    <SelectItem key={campus.id} value={campus.id}>
                      {campus.code} — {campus.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId} disabled={!campusId}>
                <SelectTrigger aria-label="Department">
                  <SelectValue placeholder={campusId ? "Select a department" : "Pick a campus first"} />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Designation</Label>
              <Select value={designationId} onValueChange={setDesignationId}>
                <SelectTrigger aria-label="Designation">
                  <SelectValue placeholder="Select a designation" />
                </SelectTrigger>
                <SelectContent>
                  {designations.map((designation) => (
                    <SelectItem key={designation.id} value={designation.id}>
                      {designation.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                The category is taken from the designation, so it does not need choosing separately.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Location (optional)</Label>
              <Select
                value={locationId || NONE}
                onValueChange={(value) => setLocationId(value === NONE ? "" : value)}
                disabled={!campusId}
              >
                <SelectTrigger aria-label="Location">
                  <SelectValue placeholder={campusId ? "Not specified" : "Pick a campus first"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not specified</SelectItem>
                  {locations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>
                      {locationLabel(location)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="positions">Number of positions</Label>
                <Input
                  id="positions"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_POSITIONS}
                  value={positions}
                  aria-invalid={trimmedPositions !== "" && !isPositionsValid}
                  onChange={(e) => setPositions(e.target.value)}
                />
                {trimmedPositions !== "" && !isPositionsValid ? (
                  <p className="text-xs text-destructive">Enter a whole number from 1 to {MAX_POSITIONS}.</p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger aria-label="Priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value.charAt(0) + value.slice(1).toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="required-by">Required by (optional)</Label>
              <Input
                id="required-by"
                type="date"
                value={requiredBy}
                onChange={(e) => setRequiredBy(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="justification">Justification</Label>
              <Textarea
                id="justification"
                rows={4}
                value={justification}
                placeholder="Why is this position needed?"
                aria-invalid={justification.trim() !== "" && !isJustificationValid}
                onChange={(e) => setJustification(e.target.value)}
              />
              {justification.trim() !== "" && !isJustificationValid ? (
                <p className="text-xs text-destructive">
                  Please give at least {MIN_JUSTIFICATION} characters of context.
                </p>
              ) : null}
            </div>

            <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <legend className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Your details
              </legend>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="requester-name">Name</Label>
                <Input
                  id="requester-name"
                  value={requesterName}
                  onChange={(e) => setRequesterName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="requester-email">Email</Label>
                <Input
                  id="requester-email"
                  type="email"
                  value={requesterEmail}
                  onChange={(e) => setRequesterEmail(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="requester-mobile">Mobile</Label>
                <Input
                  id="requester-mobile"
                  type="tel"
                  value={requesterMobile}
                  onChange={(e) => setRequesterMobile(e.target.value)}
                />
              </div>
            </fieldset>

            {error ? (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <Button type="submit" size="lg" disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending ? "Submitting..." : "Submit request"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
