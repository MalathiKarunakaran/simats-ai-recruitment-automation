# Handover

The SIMATS AI Recruitment Automation System, as handed over on 2026-09-05.
This is the one document to read first. It says what the system is, where it
runs, who does what in it, how to operate it day to day, and what was
deliberately left for later. It points to the other documents rather than
repeating them:

| Document | What it is for |
|---|---|
| `README.md` | Local development setup and the test commands |
| `DEPLOYMENT.md` | The production runbook: deploy, verify, backups, logs, the reverse proxy |
| `CLAUDE.md` | Engineering conventions, the load-bearing rules of the codebase, known gaps |
| `INITIAL.md` | The product brief: the hiring lifecycle and the fifteen modules |
| `HISTORY.md` | The original Phase 1 build notes and design decisions |
| `frontend/README.md` | Which screens exist and the frontend design decisions |
| `LOAD_TEST_RESULTS.md` | Why the backend runs four uvicorn workers |

## 1. What it is and where it runs

A campus-aware recruitment platform for SIMATS covering the whole hiring
lifecycle: sanctioned strength and vacancy requisition, a two-stage approval
chain, job posting and distribution, candidate applications, AI-assisted
screening, interviews, offers, joining and onboarding, employee records,
dashboards and reports. Backend is FastAPI on Postgres; frontend is a React
single-page app. All seven campuses are modelled: SSE, SCLAS, SCAD, STUDIO,
SPIER, SSPE and SHIFT.

| Where | Address |
|---|---|
| Application (staff sign-in) | https://app.malathi.io |
| Public vacancy-request form (QR) | https://app.malathi.io/vacancy-request/public |
| API | https://api.malathi.io |
| Source | https://github.com/MalathiKarunakaran/simats-ai-recruitment-automation |
| CI | GitHub Actions on the repository, every push to `master` |
| Server | Hostinger VPS `srv1922215.hstgr.cloud`, code in `/opt/simats/app`, five Docker containers (backend, frontend, postgres, minio, chromadb) behind a host-level Caddy proxy |

The API's interactive documentation is switched off in production on
purpose. Section 5 says how to turn it on for a debugging session.

## 2. Status at handover

**Complete and live.** All fifteen modules, the frontend for every one of
them, the production deployment, and a security audit (2026-09-03) whose
every critical, high and medium finding is fixed and verified on production.
The remaining low findings were each either fixed or closed with an explicit
decision, recorded in the git history.

**Verified by.** 1222 backend tests, 812 frontend tests and a 66-test browser
suite, all run by CI on every push. The browser suite also runs against
production after a deploy (section 6).

**Deliberately deferred**, by decision at handover, none of which blocks
daily use:

- **Email delivery.** Login by emailed code, emailed password resets, and
  notification emails all go through n8n webhooks, and no n8n instance is
  connected. Users sign in with a password; the login page offers the
  code option only when the server can deliver it. Section 5 says exactly
  what to connect.
- **Job-portal distribution** likewise needs n8n and returns a clear "not
  configured" error until then.
- **A candidate-facing portal.** Candidates and applications are entered by
  staff. A `CANDIDATE` login sees a "not permitted" page.
- **The production master data question.** Production currently holds the
  sanctioned-strength, department, designation and location data entered
  during September 2026 plus a small number of demo rows from the original
  seed. Whether that is the launch data or is to be replaced by an HR feed
  is an institutional decision, not a technical one.

## 3. Who does what

Nine roles. Which campuses a role sees is fixed per role; what a user may do
can be narrowed or widened per user by a Super Admin (section 4).

| Role | Sees | Typical use |
|---|---|---|
| SUPER_ADMIN | All campuses | Everything, including user administration and approval overrides |
| HR_ADMIN | All campuses | Final (HR) approval of vacancies, users, offers, employees, imports |
| ASSOCIATE_DEAN_RECRUITMENT | All campuses | First (Dean) approval of vacancy requests |
| RECRUITMENT_COORDINATOR | All campuses | Coordinates requests and the pipeline; extra powers granted per user |
| MANAGEMENT | All campuses | Dashboards, reports and offers, read-only oversight |
| CAMPUS_HOD | Own campus | Raises vacancy requests for their campus |
| RECRUITMENT_OFFICER | Own campus | Runs the candidate pipeline and onboarding for their campus |
| INTERVIEW_PANEL_MEMBER | Own campus | Interview feedback |
| CANDIDATE | Nothing | Reserved for the deferred candidate portal |

Campus scoping is enforced by the API, not just hidden in the interface. A
campus-scoped user asking for another campus's record gets "not found"
rather than "forbidden", so they cannot even confirm it exists. Every
consequential action is written to the Activity Log with its before and
after state.

## 4. The work, end to end

**Master data first.** Nothing can be requested against a department,
designation or location that does not exist. Under Administration a
Super Admin or HR Admin maintains Campuses, Departments (each department
lists which staff categories it may hold: Teaching, Non-Teaching,
Housekeeping), Designations (each belongs to exactly one category and is
linked to the departments it applies to), Locations (blocks and floors,
per campus), and Housekeeping Staff. Each of these pages, and Sanctioned
Strength, Eligibility Rules and Vacancy Requests, has its own bulk upload
with a downloadable template, a dry-run preview, and an error report that
names the failing rows. The Import Data page is for the recruitment-tracker
workbook specifically.

**Sanctioned Strength** is the ceiling. For every campus, department,
designation and (for housekeeping) location, it records the approved
headcount and the working headcount. The gap is what may be requested. A
request that would exceed it is refused, and two people submitting at once
cannot overshoot it: the row is locked for the length of the check.

**Raising a vacancy request** happens one of three ways, all landing in the
same queue:

1. The in-app wizard at Vacancy Requests, New request.
2. The public form, reached by scanning the QR code printed from a
   sanctioned-strength row. It needs no login. It is rate-limited per
   address, carries a hidden field that traps bots, and refuses a second
   submission from the same email within fifteen minutes. Indian mobile
   numbers only, by decision.
3. Bulk upload on the Vacancy Requests page, from its own template. Rows
   land as drafts for review; nothing auto-submits.

Separately, the Import Data page loads the recruitment-tracker workbook as
live data: its vacancy rows arrive already published and slotted, and its
candidate rows arrive as applications at their real pipeline step. It is
for bringing an ongoing drive in, not for new requests.

**The approval chain** is Draft, Submitted, Dean approved, Approved (HR),
Published, Closed; a request can be Rejected or Cancelled along the way.
HR's approval is the moment hiring slots are created. Publishing creates the
job posting. Nobody can approve or reject their own request, Super Admins
excepted, and a Super Admin may approve directly from Submitted. The Vacancy Approvals page is the
"needs your action" queue for the approvers.

**Job postings** carry an AI-drafted job description (editable before
publishing), a job-ad text and QR code, and a distribute action for the
external portals.

**Candidates and applications** move through a fixed twelve-step pipeline:
Applied, Screening, Called for interview, Interviewed, Selected, Offer
sent, Offer accepted, Joining confirmed, Joined, Department and room
allotted, Orientation complete, Handed over to HOD. Rejected and Withdrawn
end it from any earlier step. Resume screening, scoring and ranking are
optional AI assists that never gate a step. Every status change goes
through one service, which also reserves, releases and fills hiring slots
and closes the vacancy automatically when the last slot fills.

**Interviews** are scheduled with a same-campus panel, with AI-suggested
questions and structured feedback. **Offers** are created, sent and
answered; the pipeline follows. **Onboarding** tracks the joining document
checklist and ends with an employee record and a generated employee code.
**Employees** are then listed and can be offboarded.

**Reports** offers seven report types and an AD Briefing summary, each
filterable by date range and exportable to Excel or PowerPoint. Every
spreadsheet the system writes is hardened against formula injection.

**Hermes**, the assistant, is a chat widget on every page. It answers
read-only questions over the recruitment data in plain language, scoped to
what the signed-in user may see, and can produce the daily briefing.

## 5. Administration and configuration

**Users.** Super Admin and HR Admin create users at Users, New user. A
campus is required for the campus-scoped roles. Passwords are at least
twelve characters. From a user's detail page an admin can reset the
password, sign the user out of every session at once, and, for a Super
Admin, adjust three things:

- **Permissions**: the per-user matrix that overrides the role's default
  set (view and manage vacancies, candidates, interviews, offers,
  onboarding, employees, each master-data area, sanctioned strength).
- **Capability grants** for Recruitment Coordinators: vacancy approval,
  candidates and applications, interviews, job distribution and screening.
- **Department scope**: restricts a user to named departments. Nobody has
  one at handover, by decision; the coordinators see every department.

Every one of these edits is audited.

**Signing in.** Password sign-in is the default. A user changes their own
password under Settings, which ends all their other sessions. The
"forgot password" and "email me a code" paths need email delivery (below)
and report clearly that they are unavailable until then.

**Email delivery and portal distribution** need one n8n instance. Set
`N8N_BASE_URL` on the backend to its webhook base and provide four
webhooks under it: `notify` (in-app notifications going out by email or
message), `job-distribution`, `send-otp-email` and
`send-password-reset-email`. The last two have no workflow written yet.
Until the variable is set, notifications are recorded as failed with the
reason, rather than pretending to be sent.

**AI features** need `OPENAI_API_KEY`, which is set in production. Job
description drafting, resume scoring, interview questions and Hermes all
use it. Without it those actions return "AI features are not configured".

**Environment variables** live in `/opt/simats/app/.env` on the server and
are documented line by line in `.env.example`. The ones an operator
actually touches:

| Variable | Purpose |
|---|---|
| `JWT_SECRET_KEY` | Signs sessions. Changing it signs everyone out. |
| `POSTGRES_PASSWORD`, `MINIO_*` | Database and file-store credentials |
| `OPENAI_API_KEY` | AI features |
| `N8N_BASE_URL` | Email, notifications and portal distribution |
| `CORS_ALLOWED_ORIGINS` | The frontend's origin. Also the CSRF allow-list. |
| `PUBLIC_APPLY_BASE_URL` | The careers-page base used in job ads |
| `UVICORN_WORKERS` | Backend workers, four by default |
| `EXPOSE_API_DOCS` | Set `true` and restart the backend to get `/docs` back for a debugging session; unset it afterwards |

`ENVIRONMENT=production` is set in `docker-compose.yml`, not in `.env`.
It is what makes cookies secure-only, hides the API docs, and stops login
codes from ever being printed to a log.

## 6. Day-to-day operations

**Deploying a change.** Push to `master`, wait for CI to go green, then on
the server follow `DEPLOYMENT.md` sections 2 to 4: pull, check the commit
hash printed by `git log`, build, start, verify. Migrations run
automatically when the backend container starts. Two traps that have each
cost a day are written up there: a `git pull` that fails while the build
still succeeds on the old code, and a Caddy block that served a stale
on-disk copy of the frontend instead of the container.

**Checking a deploy actually landed.** From any machine:

```bash
curl -s https://api.malathi.io/health
curl -sI https://app.malathi.io | grep -i content-security-policy
```

and, for the full browser check against production, from a checkout of
the repository:

```bash
npx playwright test          # public screens only, no login needed
```

For the authenticated screens the suite needs a token pair minted inside
the backend container; `scripts/e2e_mint_tokens.py` documents the command.

**Backups.** Nightly and automatic since 2026-09-05, verified by a real
restore every Sunday: `DEPLOYMENT.md` section 8 has the schedule, the
restore commands and the two timestamp files to check. Postgres holds
everything except uploaded resumes and bulk-upload originals, which are in
MinIO; both are backed up. What is still missing is a destination outside
the VPS: the scripts mirror to `BACKUP_REMOTE` as soon as one is
configured, and until then the Hostinger VPS backup is the only off-server
copy.

**Logs.** `docker compose logs -f backend` on the server. The backend logs
one warning line at startup when email delivery is unconfigured, and one
info line saying which proxy address it trusts for real client IPs.

**Rotating a secret.** Edit `.env`, then `docker compose up -d` to recreate
the affected container. Changing `JWT_SECRET_KEY` signs every user out.

**Rate limits.** Login, code requests, and the public form are
rate-limited per client address, in memory, per worker. With four workers
each configured limit is effectively four times larger. This is documented,
not fixed.

**Sessions.** By default, access tokens last thirty minutes and are
refreshed silently from an HttpOnly cookie that lasts seven days. A refresh token presented
twice is treated as stolen: that session family is revoked and the event is
audited. Because the cookie is same-site strict, the application and API
must stay on one registrable domain, as they are now.

## 7. Development and testing

`README.md` has local setup. Postgres runs as a native Windows service on
the development machine, not in Docker. MinIO and ChromaDB are not run
locally; everything that touches them degrades to a warning rather than
failing, so the whole surface is testable without them.

CI runs four independent jobs on every push: the backend suite against a
real Postgres, the frontend type-check, lint and unit tests, the migration
chain against an empty database with a schema-drift check, and the browser
suite against the built bundle and a live backend seeded by
`scripts/e2e_seed.py`. A red job blocks nothing mechanically. The rule has
been not to deploy on red.

Conventions that must not be broken are in `CLAUDE.md`. The three that
matter most: only `vacancy_workflow.py` moves a vacancy request between
statuses, only `pipeline.py` moves an application, and department
categories are a set checked by membership, never an equality.

## 8. Troubleshooting

| Symptom | Look at |
|---|---|
| Deploy "done" but the site looks unchanged | `DEPLOYMENT.md` section 7: a stale Caddy `file_server` block, or a `git pull` that failed |
| Everyone signed out at once | `JWT_SECRET_KEY` changed, or the API moved to another domain (cookie is same-site strict) |
| "AI features are not configured" | `OPENAI_API_KEY` missing on the backend container |
| Notifications show as failed | Expected without `N8N_BASE_URL`; the reason is on each row |
| Login page has no "email me a code" option | Expected without `N8N_BASE_URL` in production |
| `/docs` returns 404 in production | By design; set `EXPOSE_API_DOCS=true` temporarily |
| A public form submission gets a bare 400 or 429 | The bot trap or the fifteen-minute per-email cooldown; both are audited as `PUBLIC_VACANCY_REQUEST_BLOCKED` |
| Many users throttled after one person's failed logins | The proxy address is being trusted as the client; check the "Trusting X-Forwarded-For" startup line |
| Local `pytest` fails with missing columns | A killed earlier run left stale tables in the test database; drop them and rerun |
| Local `tsc --noEmit` passes but the build fails | Use `npx tsc -b --force`; the root tsconfig checks zero files |
| SSH to the VPS drops immediately | Use `ssh -4`; the IPv6 path is unreliable |

## 9. Suggested next steps, in order

1. A backup destination outside the VPS, set as `BACKUP_REMOTE` in the
   cron file. Nightly backups and weekly restore checks already run.
2. Connect n8n and write the two missing email workflows, then turn on
   code-based login for staff who prefer it.
3. Decide the launch data: keep what is in production, or replace it from
   an HR feed using the bulk-upload templates.
4. A candidate portal, if the institution wants candidates to apply
   directly.
