# HOD review + permanent order (pipeline brief Phase 5)

Status: AGREED 2026-10-31.

## Decisions (user, 31-Oct-2026)

| # | Decision |
|---|---|
| H1 | For **in-app hires (Applications) only**. Sheet joiners keep being tracked in the Pro App Order sheet (shown read-only on Provisional Orders). |
| H2 | The HOD review can be recorded by a **Campus HOD for their own campus**, and by Recruitment Coordinators, HR Admin and Super Admin on the HOD's behalf. |
| H3 (brief + decision C, 29-Oct) | Two new statuses after `HANDED_OVER_TO_HOD`, which stops being terminal: `HOD_REVIEW_COMPLETE`, then `PERMANENT_ORDER_ISSUED` (terminal). Two permanent enum values (decision B). Employee creation stays at handover. |
| H4 (default) | Only a **"Recommend for permanent"** review moves the application to `HOD_REVIEW_COMPLETE`. "Extend probation" requires a **new probation end date** and keeps the status; "Not recommended" keeps the status and marks the record. Several reviews may be recorded; each is kept (history), the latest one is shown. No automatic separation — that stays the existing offboarding action. |
| H5 (brief) | The permanent order comes from the Registrar's office: the app **records** it (Registrar ref. no., order date, date issued to the faculty member, signed-order upload) and generates no letter. Only from `HOD_REVIEW_COMPLETE`. |

## Data

- `hod_reviews`: application, HOD name (typed; prefilled with the department's HOD when known), review date, recommendation (`RECOMMEND_PERMANENT` | `EXTEND_PROBATION` | `NOT_RECOMMENDED`), new probation end (required for extend), remarks, signed review file (optional), recorded by/at.
- `permanent_orders`: application (unique), registrar ref. no., order date, issued to faculty on, signed order file, recorded by/at.
- Probation end shown everywhere = the latest "Extend probation" date, else the provisional order's probation end.

Every write goes through `pipeline.transition_application_status` for the status and writes an audit row with the actor. Files stored like joining documents (PDF/JPEG/PNG, magic bytes, 10 MB, hard-fail 502).

## API (joining router family)

- `POST /applications/{id}/hod-reviews` (multipart optional file) · `GET /applications/{id}/hod-reviews`
- `GET /applications/{id}/hod-reviews/{rid}/file`
- `POST /applications/{id}/permanent-order` · `GET .../permanent-order` · file upload/download
- Roles: reviews — SUPER_ADMIN, HR_ADMIN, RECRUITMENT_COORDINATOR, CAMPUS_HOD (own campus via the existing campus scope: another campus is 404). Permanent order — SUPER_ADMIN, HR_ADMIN, RECRUITMENT_COORDINATOR.

## Screens

- Application's onboarding card: at `HANDED_OVER_TO_HOD`, **Record HOD review** (form above) + review history; at `HOD_REVIEW_COMPLETE`, **Record permanent order**; then the order details.
- Onboarding page: the two stages in the stage filter; a **Days since joining** column; rows **past probation end with no "Recommend" review** highlighted, plus a filter for them.
