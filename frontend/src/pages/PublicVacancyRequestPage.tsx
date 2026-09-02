import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, CheckCircle2, Copy } from "lucide-react";
import { useMemo, useState } from "react";

import { ApiError } from "@/api/client";
import {
  getPublicFormOptions,
  submitPublicVacancyRequest,
  type PublicFormLocation,
  type PublicVacancyRequestConfirmation,
} from "@/api/publicVacancyRequests";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { email as emailValidator, indianMobile } from "@/hooks/useFieldValidation";
import { compareLocationsForDisplay, locationDedupeKey, locationLabel } from "@/lib/locationDisplay";

// The public, unauthenticated vacancy-request form reached by scanning the QR
// code (2026-08-30). Mounted OUTSIDE ProtectedRoute and outside AppShell, so
// it renders no navigation, no campus switcher and no link back into the
// authenticated app -- a visitor here should not learn that the rest of the
// application exists, let alone be invited into it.
//
// Because it is unauthenticated there is no profile to prefill Name/Email/
// Mobile from: `useAuth` is not even in scope here. Those three stay editable
// and are validated instead, and are stored on the request row itself
// (`requester_name`/`_email`/`_mobile`) rather than being duplicated anywhere
// else -- `requested_by_id` remains the intake account, not the person.
//
// Mobile-first: a single column, large touch targets, no table or drawer. It
// is reached by phone camera, so a desktop-shaped layout would be the wrong
// default.

const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

/** Mirrors the backend's own bounds (PublicVacancyRequestCreate, which keeps
 * these as named constants for exactly this reason). Kept in step
 * deliberately so the form refuses locally what the server would refuse
 * anyway, instead of letting someone fill in a long form and lose it to a
 * 422. The server remains authoritative. */
const MAX_POSITIONS = 100;
const MIN_JUSTIFICATION = 10;
const MIN_NAME = 2;

const isValidEmail = emailValidator();
const isValidMobile = indianMobile();

/** Local (not UTC) yyyy-mm-dd. `new Date().toISOString()` would give the UTC
 * date, which in IST is the PREVIOUS day until 05:30 -- that would set the
 * date picker's floor a day early and let a genuinely past date through. */
function todayLocalIso(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** Marks a field required for sighted users without changing its accessible
 * name: `aria-hidden` keeps the asterisk out of the name computation, so the
 * field is still addressable as plain "Justification" by assistive tech and
 * by tests. Required-ness is conveyed to assistive tech by `aria-required`
 * on the control itself. */
function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-destructive">
      *
    </span>
  );
}

/** One option per distinct physical place, ordered block-then-floor.
 *
 * The public form's location shape has no `is_active` (the endpoint only ever
 * returns active rows), so this cannot use `dedupeLocationsForPicker`
 * directly -- but it must use the same KEY, or the public form would show the
 * six identical "CB Block" rows the authenticated pickers collapse. Ties
 * break on the smallest id, so the same option is chosen on every render. */
function dedupePublicLocations(locations: readonly PublicFormLocation[]): PublicFormLocation[] {
  const best = new Map<string, PublicFormLocation>();
  for (const location of locations) {
    const key = locationDedupeKey(location);
    const incumbent = best.get(key);
    if (incumbent === undefined || location.id < incumbent.id) best.set(key, location);
  }
  return [...best.values()].sort(compareLocationsForDisplay);
}

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
  const [copied, setCopied] = useState(false);

  // Refetched per campus so Department and Location narrow as soon as a campus
  // is picked -- the same cascade the authenticated forms use.
  const { data: options, isLoading } = useQuery({
    queryKey: ["public-form-options", campusId],
    queryFn: () => getPublicFormOptions(campusId || null),
  });

  const today = useMemo(todayLocalIso, []);
  const departments = options?.departments ?? [];
  const designations = options?.designations ?? [];

  // Campus is the ONLY narrowing applied to locations, deliberately. A
  // Location is a physical place -- a room does not stop existing because the
  // post is non-teaching -- so there is no category condition here and there
  // must never be one. The identical filter on the Sanctioned Strength drawer
  // left every NON_TEACHING and HOUSEKEEPING row with an empty dropdown in
  // production (fixed in d28d72c). Teaching and Non-Teaching see exactly the
  // same list.
  const locations = useMemo(() => dedupePublicLocations(options?.locations ?? []), [options?.locations]);

  // Required, but only where the data exists -- mirrors
  // `vacancy_request_rules.validate_location` on the server. Only 2 of 7
  // campuses have any locations at all, and a flat requirement made it
  // impossible to submit on the other five. Tightens by itself as soon as a
  // campus gets its first location.
  const locationRequired = locations.length > 0;

  const selectedDepartment = departments.find((d) => d.id === departmentId);
  // Only the designations the chosen department may actually contain. A
  // MEMBERSHIP test against `supported_categories`, never an equality test --
  // a department employs Teaching and Non-Teaching staff at the same time.
  // With no list from the server (older backend) nothing is hidden, because
  // an empty designation picker is a worse failure than a late 400.
  //
  // Not memoized on purpose: `designations` is rebuilt on every render by the
  // `?? []` default above, so a useMemo keyed on it would recompute anyway
  // while claiming not to. Filtering a list this short costs nothing.
  const supportedCategories = selectedDepartment?.supported_categories;
  const availableDesignations =
    supportedCategories && supportedCategories.length > 0
      ? designations.filter((d) => supportedCategories.includes(d.category))
      : designations;

  const selectedDesignation = designations.find((d) => d.id === designationId);
  const derivedCategory = selectedDesignation
    ? selectedDesignation.category.replace(/_/g, "-").toLowerCase().replace(/(^|-)([a-z])/g, (m) => m.toUpperCase())
    : null;

  const trimmedPositions = positions.trim();
  const positionsNumber = Number(trimmedPositions);
  // The regex is what rejects "1.5", "1e3", "-1" and "abc": `type="number"`
  // alone does not, because the browser hands back "" for some of those and a
  // parseable float for others.
  const isPositionsValid =
    /^\d+$/.test(trimmedPositions) && positionsNumber >= 1 && positionsNumber <= MAX_POSITIONS;
  const isJustificationValid = justification.trim().length >= MIN_JUSTIFICATION;
  const isNameValid = requesterName.trim().length >= MIN_NAME;
  const isEmailValid = requesterEmail.trim().length > 0 && isValidEmail(requesterEmail) === null;
  const isMobileValid = requesterMobile.trim().length > 0 && isValidMobile(requesterMobile) === null;
  const isRequiredByValid = requiredBy === "" || requiredBy >= today;

  const canSubmit =
    Boolean(campusId && departmentId && designationId) &&
    (!locationRequired || Boolean(locationId)) &&
    isPositionsValid &&
    isJustificationValid &&
    isRequiredByValid &&
    isNameValid &&
    isEmailValid &&
    isMobileValid;

  const mutation = useMutation({
    mutationFn: () =>
      submitPublicVacancyRequest({
        campus_id: campusId,
        department_id: departmentId,
        designation_id: designationId,
        location_id: locationId,
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
    // "Something went wrong" would leave the requester with no next step. A
    // non-ApiError (a dropped connection, DNS failure) has no message worth
    // showing, so that one case gets wording that says what to do about it.
    //
    // Nothing here clears the form: a failed submission must leave every
    // entered value in place so the requester can fix one field and retry
    // rather than filling the whole thing in again on a phone.
    onError: (err) =>
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not reach the server. Check your connection and try again.",
      ),
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    // The double-submit guard. The button is also disabled while pending, but
    // a form can still be submitted by Enter between the click and the
    // re-render, and two identical submissions are two real vacancy requests
    // -- the backend creates rather than upserts, so nothing downstream would
    // collapse them.
    if (!canSubmit || mutation.isPending) return;
    setError(null);
    mutation.mutate();
  }

  async function handleCopy(reference: string) {
    try {
      await navigator.clipboard?.writeText(reference);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused (insecure origin, denied permission).
      // The reference is on screen and selectable, so there is nothing to
      // report -- failing silently is better than an error about a
      // convenience.
    }
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
                  id is never sent to a public submitter, and it is generated
                  by the backend, never here. */}
              <div className="flex items-center justify-center gap-2">
                <p className="font-mono text-2xl font-bold break-all text-foreground">
                  {confirmation.request_ref}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Copy Request ID"
                  onClick={() => handleCopy(confirmation.request_ref)}
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-brand-success" aria-hidden />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden />
                  )}
                </Button>
              </div>
              {copied ? (
                <p role="status" className="text-xs text-muted-foreground">
                  Copied
                </p>
              ) : null}
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
            <p className="text-xs text-muted-foreground">
              Fields marked <span className="text-destructive">*</span> are required.
            </p>

            <div className="flex flex-col gap-1.5">
              <Label>
                Campus
                <RequiredMark />
              </Label>
              <Select
                value={campusId}
                onValueChange={(value) => {
                  setCampusId(value);
                  // Department and Location are campus-scoped, so a campus
                  // change must clear them -- otherwise a stale selection is
                  // submitted and refused server-side for a reason the
                  // requester cannot see on screen. Designation goes too,
                  // because it is validated against the department.
                  setDepartmentId("");
                  setDesignationId("");
                  setLocationId("");
                }}
              >
                <SelectTrigger aria-label="Campus" aria-required="true">
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
              <Label>
                Department
                <RequiredMark />
              </Label>
              <Select
                value={departmentId}
                onValueChange={(value) => {
                  setDepartmentId(value);
                  // Which designations are valid depends on the department's
                  // supported categories, so a department change must clear a
                  // designation chosen under the previous one.
                  setDesignationId("");
                }}
                disabled={!campusId}
              >
                <SelectTrigger aria-label="Department" aria-required="true">
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
              <Label>
                Designation
                <RequiredMark />
              </Label>
              <Select value={designationId} onValueChange={setDesignationId} disabled={!departmentId}>
                <SelectTrigger aria-label="Designation" aria-required="true">
                  <SelectValue
                    placeholder={departmentId ? "Select a designation" : "Pick a department first"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableDesignations.map((designation) => (
                    <SelectItem key={designation.id} value={designation.id}>
                      {designation.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Category is DERIVED, never asked for -- there is deliberately
                  no Category field on this form. Showing what the choice
                  implies is display only; the value submitted is the
                  designation id and the server reads the category off
                  Designation Master. */}
              <p className="text-[11px] text-muted-foreground">
                {derivedCategory
                  ? `Category: ${derivedCategory} — taken from the designation, so it does not need choosing separately.`
                  : "The category is taken from the designation, so it does not need choosing separately."}
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>
                Location
                {locationRequired ? <RequiredMark /> : <span className="text-muted-foreground"> (optional)</span>}
              </Label>
              <Select value={locationId} onValueChange={setLocationId} disabled={!campusId}>
                <SelectTrigger aria-label="Location" aria-required={locationRequired}>
                  <SelectValue placeholder={campusId ? "Select a location" : "Pick a campus first"} />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>
                      {locationLabel(location)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {campusId && locations.length === 0 ? (
                // Informational, not an error: this campus simply has no
                // location master data yet, so the field is not required and
                // the request can still be raised.
                <p className="text-xs text-muted-foreground">
                  No locations are set up for this campus yet, so this is not required.
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="positions">
                  Number of positions
                  <RequiredMark />
                </Label>
                <Input
                  id="positions"
                  type="number"
                  inputMode="numeric"
                  step={1}
                  min={1}
                  max={MAX_POSITIONS}
                  value={positions}
                  required
                  aria-invalid={trimmedPositions !== "" && !isPositionsValid}
                  onChange={(e) => setPositions(e.target.value)}
                />
                {trimmedPositions !== "" && !isPositionsValid ? (
                  <p className="text-xs text-destructive">Enter a whole number from 1 to {MAX_POSITIONS}.</p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>
                  Priority
                  <RequiredMark />
                </Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger aria-label="Priority" aria-required="true">
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
                // `min` is the browser's own affordance; the explicit check
                // below is what actually blocks submission, because a typed
                // (rather than picked) date bypasses `min` in several
                // browsers. The server re-checks it a third time.
                min={today}
                aria-invalid={!isRequiredByValid}
                onChange={(e) => setRequiredBy(e.target.value)}
              />
              {!isRequiredByValid ? (
                <p className="text-xs text-destructive">The required-by date cannot be in the past.</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="justification">
                Justification
                <RequiredMark />
              </Label>
              <Textarea
                id="justification"
                rows={4}
                value={justification}
                required
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
                <Label htmlFor="requester-name">
                  Name
                  <RequiredMark />
                </Label>
                <Input
                  id="requester-name"
                  value={requesterName}
                  required
                  aria-invalid={requesterName.trim() !== "" && !isNameValid}
                  onChange={(e) => setRequesterName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="requester-email">
                  Email
                  <RequiredMark />
                </Label>
                <Input
                  id="requester-email"
                  type="email"
                  value={requesterEmail}
                  required
                  aria-invalid={requesterEmail.trim() !== "" && !isEmailValid}
                  onChange={(e) => setRequesterEmail(e.target.value)}
                />
                {requesterEmail.trim() !== "" && !isEmailValid ? (
                  <p className="text-xs text-destructive">Enter a valid email address.</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="requester-mobile">
                  Mobile
                  <RequiredMark />
                </Label>
                <Input
                  id="requester-mobile"
                  type="tel"
                  inputMode="tel"
                  value={requesterMobile}
                  required
                  aria-invalid={requesterMobile.trim() !== "" && !isMobileValid}
                  onChange={(e) => setRequesterMobile(e.target.value)}
                />
                {requesterMobile.trim() !== "" && !isMobileValid ? (
                  <p className="text-xs text-destructive">Enter a valid 10-digit Indian mobile number.</p>
                ) : null}
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
