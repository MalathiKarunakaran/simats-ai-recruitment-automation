# SIMATS AI Recruitment Automation System

## What it is

An AI-assisted recruitment automation platform for SIMATS (Saveetha Institute
of Medical and Technical Sciences), a NAAC A++ deemed university operating
across 7 campuses (`SSE, SCLAS, SCAD, STUDIO, SPIER, SHOTS, SSPE`). It
replaces manual, spreadsheet/email-driven hiring coordination with a single
system of record that carries a position from "we need to hire someone"
through to "they're an employee with a record in the system" — enforcing the
real institutional approval chain, campus-scoped visibility, and an audit
trail at every step, while using AI (OpenAI GPT-4o and Anthropic Claude) to
remove the most time-consuming manual work: writing job descriptions,
screening resumes, and drafting interview questions.

## Who it's for

- **HR Admins** — organization-wide visibility; final approval authority on
  vacancy requests; manage users, employees, offers.
- **Associate Dean, Recruitment** — first-stage (Dean) approval on vacancy
  requests; organization-wide visibility.
- **Campus HODs** — raise vacancy requests for their own campus.
- **Recruitment Officers** — campus-scoped; run the day-to-day candidate
  pipeline (applications, screening, publishing job postings) for their
  campus.
- **Interview Panel Members** — campus-scoped; submit interview feedback.
- **Management** — organization-wide read access to dashboards/reports/offers
  for oversight, not day-to-day data entry.
- **Candidates** — the applicant-facing side of the pipeline (application
  records, resumes).
- **Super Admin** — unrestricted, cross-campus, including override paths in
  the approval chain (e.g. can HR-approve directly from SUBMITTED, skipping
  Dean approval).

Role-based access is enforced on the backend (`app/core/deps.py`); campus
scoping means most roles only ever see their own campus's data, while a
defined set of roles (Super Admin, HR Admin, Associate Dean, Management) see
all 7 campuses.

## The hiring lifecycle it automates

1. **Requisition** — a Campus HOD raises a Vacancy Request (position, role
   category, count, qualification, experience, salary band, priority).
2. **Approval chain** — Submit → Dean approval → HR approval (HR's approval
   is final and creates the actual Hiring Slots to fill) → Publish (creates
   the public Job Posting) → Close (manual or automatic once every slot is
   filled).
3. **Job description & distribution** — AI-generated JD drafts (human-
   reviewed/edited before publish), job-ad text/QR codes, and distribution to
   external job portals via an n8n-mediated webhook integration.
4. **Candidate pipeline** — candidates apply against a published posting;
   resumes are screened and scored by AI (eligibility, skill/qualification/
   experience match, semantic-duplicate detection) and ranked; applications
   move forward through a fixed pipeline of statuses (Applied → Screening →
   Eligible → Shortlisted → Interview stages → Selected → Offer → Joining →
   Employee), or terminate via Rejected/Withdrawn from any non-terminal
   status.
5. **Interviews** — scheduling (technical/HR/teaching-demo/general), panel
   assignment (same-campus only), AI-suggested interview questions, and
   structured panel feedback/recommendation capture.
6. **Offers** — offer creation, sending, and candidate response tracking,
   which advances the pipeline in step with pipeline state (idempotent with
   respect to pipeline position, so out-of-order or repeated calls don't
   error).
7. **Joining & onboarding** — a joining document checklist, onboarding
   completion, and employee record creation — the point a candidate becomes
   an Employee with a generated employee code.
8. **Reporting & AI assistant** — an executive dashboard (KPIs, date-range
   filtering, campus/category/source breakdowns), a fixed set of recruitment/
   hiring reports exportable to Excel, a single-slide PPT AD-briefing export,
   and "Hermes" — a read-only natural-language assistant/daily-briefing
   feature over the recruitment data, campus-scoped like everything else.

Every state transition (vacancy status, application status, hiring-slot
reserve/release/fill) goes through one dedicated service (`vacancy_workflow.py`
or `pipeline.py`) rather than being scattered across routers, and every
consequential action is written to an audit log with before/after state.

## Modules

Enumerated from the actual routers (`app/api/v1/routers/`) and frontend pages
(`frontend/src/pages/`):

1. **Auth** — login, JWT access/refresh tokens, password reset.
2. **Vacancy Requisition & Approval** — Vacancy Requests, the Submit → Dean →
   HR → Publish → Close chain, Approved Vacancies, Hiring Slots.
3. **JD Generation** — AI-drafted job descriptions (OpenAI, structured JSON
   output), editable before publish.
4. **Job Ads & Distribution** — job-ad text, QR codes, distribution to
   external portals via n8n.
5. **Candidate Portal / Applications** — candidate records, applications
   against job postings.
6. **AI Resume Screening & Ranking** — resume upload (MinIO storage),
   AI extraction/scoring (OpenAI), semantic duplicate detection (ChromaDB),
   candidate ranking by score.
7. **Vacancy/Application Pipeline** — the Application status state machine
   and Hiring Slot lifecycle (`app/services/pipeline.py`).
8. **Interview Management** — scheduling, panel assignment, AI-suggested
   questions, feedback capture.
9. **Offers** — offer creation/sending/response tracking.
10. **Joining & Onboarding** — joining document checklist, onboarding
    completion.
11. **Auto-Closure Engine** — automatic vacancy close when every hiring slot
    for it is filled (part of the pipeline service, not a separate router).
12. **Executive Dashboard & Reporting** — KPIs, date-range filtering, 7
    recruitment/hiring reports, Excel/PPTX export.
13. **Notifications** — in-app + n8n-mediated delivery (email/Telegram/SMS/
    WhatsApp channels modeled), fan-out to roles or individual recipients.
14. **Hermes (AI Assistant)** — read-only natural-language query tool and
    daily HR briefing, built on a manual Claude tool-use loop, campus-scoped
    like every other read path.
15. **Employees** — read-only employee records (list/detail) created at the
    end of the pipeline; no termination/offboarding tracking yet.

Supporting/cross-cutting pieces that aren't user-facing "modules" but are
part of the product: **Users** (staff account management), **Campuses** &
**Departments** (reference data), **Audit Log** (organization activity
trail, role-gated read access), **Legacy Migration** (CSV importer for
vacancy data coming from an existing n8n + Airtable pipeline — every imported
row lands as a DRAFT for human review, nothing auto-publishes).

## Source document

This file summarizes the product; `reference/RTCFR Prompt.docx` is the
original brief it's derived from — the full Role/Task/Context/Features/Result
prompt that specified all 15 modules, the 7-phase build plan, and the
non-negotiable preservation rules (campus codes and Teaching/Non-Teaching/
Housekeeping role categories must never be renamed or reformatted). It's
intentionally untracked by git (a binary `.docx`, not source code) but stays
in the repo as the reference of record — read it directly for the original
wording on anything this summary compresses or omits.

## What this is not (yet)

The frontend does not yet have a screen for every module — check
`frontend/README.md` for current status. There is no self-service candidate-
facing web portal (Module 5's "candidate portal" concept is data-model/API
support for applications, not a public-facing apply site with its own UI).
Employees are read-only once created — no termination/offboarding workflow
exists. AI features require real Anthropic/OpenAI API keys to function live;
without them the relevant endpoints return a clean 503 rather than failing
unpredictably.
