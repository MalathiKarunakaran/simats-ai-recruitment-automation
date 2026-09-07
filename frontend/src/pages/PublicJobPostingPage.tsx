import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Briefcase, CalendarClock, CheckCircle2, GraduationCap, MapPin, Users } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { applyToPublicPosting, getPublicPosting, type PublicApplicationConfirmation } from "@/api/publicCareers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { email as emailValidator, indianMobile } from "@/hooks/useFieldValidation";
import { CATEGORY_LABELS, formatDate, formatEmploymentType } from "@/lib/careersDisplay";

// One posting's public page with the apply form (2026-09-07). Reached from
// the careers list, from the QR code on a printed ad, or from the apply link
// in an external portal listing -- so it must work as a landing page with no
// prior state, and it must still say something useful when the posting has
// closed since the poster went up.
//
// Same footing as PublicVacancyRequestPage: outside ProtectedRoute and
// AppShell, mobile-first, validated locally so a candidate does not lose a
// filled form to a 422, with the server remaining authoritative.

/** Mirrors app/schemas/public_careers.py and the staff resume upload. */
const MIN_NAME = 2;
const MAX_NAME = 150;
const MAX_RESUME_BYTES = 10 * 1024 * 1024;

const isValidEmail = emailValidator();
const isValidMobile = indianMobile();

function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-destructive">
      *
    </span>
  );
}

export function PublicJobPostingPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [resume, setResume] = useState<File | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  // Honeypot: never visible, always sent, must stay empty.
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PublicApplicationConfirmation | null>(null);

  const { data: posting, isLoading, error: loadError } = useQuery({
    queryKey: ["public-posting", slug],
    queryFn: () => getPublicPosting(slug),
    enabled: slug !== "",
    retry: false,
  });

  const isNameValid = fullName.trim().length >= MIN_NAME && fullName.trim().length <= MAX_NAME;
  const isEmailValid = email.trim().length > 0 && isValidEmail(email) === null;
  const isPhoneValid = phone.trim() === "" || isValidMobile(phone) === null;
  const canSubmit = isNameValid && isEmailValid && isPhoneValid && resume !== null && resumeError === null;

  const mutation = useMutation({
    mutationFn: () =>
      applyToPublicPosting(slug, {
        full_name: fullName.trim(),
        email: email.trim(),
        phone_number: phone.trim(),
        resume: resume!,
        website,
      }),
    onSuccess: (data) => setConfirmation(data),
    // The server's refusals are specific ("already exists for this posting",
    // "no longer accepting applications") and shown verbatim; a dropped
    // connection gets wording that says what to do. Nothing clears the form.
    onError: (err) =>
      setError(
        err instanceof ApiError ? err.message : "Could not reach the server. Check your connection and try again.",
      ),
  });

  function handleResumeChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setResume(file);
    if (file === null) {
      setResumeError(null);
    } else if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setResumeError("Please upload your resume as a PDF.");
    } else if (file.size > MAX_RESUME_BYTES) {
      setResumeError("The resume must be 10 MB or smaller.");
    } else {
      setResumeError(null);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || mutation.isPending) return;
    setError(null);
    mutation.mutate();
  }

  if (isLoading) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <p className="text-center text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (loadError || !posting) {
    const notFound = loadError instanceof ApiError && loadError.status === 404;
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-4 py-10">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <h1 className="text-xl font-bold text-foreground">{notFound ? "Posting not found" : "Something went wrong"}</h1>
            <p className="text-sm text-muted-foreground">
              {notFound
                ? "This link does not match any posting. It may have been mistyped."
                : "Could not load this posting. Please try again in a moment."}
            </p>
            <Button variant="outline" asChild>
              <Link to="/careers">See all openings</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (confirmation) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-4 py-10">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-brand-success" aria-hidden />
            <h1 className="text-xl font-bold text-foreground">Application received</h1>
            <p className="text-sm text-muted-foreground">
              Thank you, {confirmation.applicant_name}. Your application for{" "}
              <span className="font-medium text-foreground">{confirmation.title}</span> has been recorded.
            </p>
            {confirmation.posting_number ? (
              <div>
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Posting number</p>
                <p className="font-mono text-2xl font-bold text-foreground">{confirmation.posting_number}</p>
              </div>
            ) : null}
            <p className="mt-2 text-sm text-muted-foreground">
              Please quote the posting number if you contact us. The recruitment team will be in touch if you are
              shortlisted.
            </p>
            <Button variant="outline" asChild>
              <Link to="/careers">See other openings</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const accepting = posting.is_accepting_applications;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <Link to="/careers" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> All openings
      </Link>

      <header className="mb-6">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          SIMATS Careers{posting.posting_number ? ` · ${posting.posting_number}` : ""}
        </p>
        <h1 className="font-display text-2xl font-bold text-foreground">{posting.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline">{CATEGORY_LABELS[posting.role_category]}</Badge>
          {!accepting ? <Badge variant="caution">No longer accepting applications</Badge> : null}
        </div>
      </header>

      <Card className="mb-6">
        <CardContent className="p-5">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div>
                <dt className="text-xs text-muted-foreground">Campus and department</dt>
                <dd className="font-medium text-foreground">
                  {posting.campus_name} ({posting.campus_code}) · {posting.department_name}
                </dd>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div>
                <dt className="text-xs text-muted-foreground">Employment type</dt>
                <dd className="font-medium text-foreground">{formatEmploymentType(posting.employment_type)}</dd>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div>
                <dt className="text-xs text-muted-foreground">Qualification</dt>
                <dd className="font-medium text-foreground">{posting.qualification}</dd>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div>
                <dt className="text-xs text-muted-foreground">Experience and positions</dt>
                <dd className="font-medium text-foreground">
                  {posting.experience_required} · {posting.positions_open}{" "}
                  {posting.positions_open === 1 ? "position" : "positions"}
                </dd>
              </div>
            </div>
            <div className="flex items-start gap-2 sm:col-span-2">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div>
                <dt className="text-xs text-muted-foreground">Apply by</dt>
                <dd className="font-medium text-foreground">
                  {posting.apply_deadline ? formatDate(posting.apply_deadline) : "Open until filled"}
                </dd>
              </div>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          {/* CardTitle is a div; a public page's sections should be real
              headings for screen readers and for the browser tests. */}
          <CardTitle role="heading" aria-level={2}>
            About this position
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap font-sans text-sm text-foreground">{posting.ad_body}</pre>
          {posting.contact_email ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Questions? Write to <a className="underline" href={`mailto:${posting.contact_email}`}>{posting.contact_email}</a>.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {accepting ? (
        <Card id="apply">
          <CardHeader>
            {/* CardTitle is a div; a public page's sections should be real
              headings for screen readers and for the browser tests. */}
          <CardTitle role="heading" aria-level={2}>
            Apply for this position
          </CardTitle>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
              <p className="text-xs text-muted-foreground">
                Fields marked <span className="text-destructive">*</span> are required. Upload your resume as a PDF.
              </p>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="full-name">
                  Full name
                  <RequiredMark />
                </Label>
                <Input
                  id="full-name"
                  autoComplete="name"
                  value={fullName}
                  required
                  aria-invalid={fullName.trim() !== "" && !isNameValid}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">
                  Email
                  <RequiredMark />
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  required
                  aria-invalid={email.trim() !== "" && !isEmailValid}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {email.trim() !== "" && !isEmailValid ? (
                  <p className="text-xs text-destructive">Enter a valid email address.</p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="phone">Mobile (optional)</Label>
                <Input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  aria-invalid={!isPhoneValid}
                  onChange={(e) => setPhone(e.target.value)}
                />
                {!isPhoneValid ? (
                  <p className="text-xs text-destructive">Enter a valid 10-digit Indian mobile number.</p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="resume">
                  Resume (PDF)
                  <RequiredMark />
                </Label>
                <Input
                  id="resume"
                  type="file"
                  accept="application/pdf,.pdf"
                  required
                  aria-invalid={resumeError !== null}
                  onChange={handleResumeChange}
                />
                {resumeError ? <p className="text-xs text-destructive">{resumeError}</p> : null}
              </div>

              {/* Honeypot: off-screen, out of the tab order, hidden from
                  assistive technology. A person never reaches it. */}
              <div
                aria-hidden="true"
                className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden"
                data-testid="honeypot"
              >
                <label htmlFor="website">Website</label>
                <input
                  id="website"
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>

              {error ? (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <Button type="submit" size="lg" disabled={!canSubmit || mutation.isPending}>
                {mutation.isPending ? "Submitting…" : "Submit application"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            This posting is no longer accepting applications.{" "}
            <Link to="/careers" className="underline">
              See the current openings.
            </Link>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
