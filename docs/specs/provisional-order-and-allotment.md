# Provisional order + department allotment (pipeline brief Phase 4, step B)

Status: AGREED 2026-10-31, except the letter wording and order-number
format, which wait for the user's sample letter (Q2/Q3 below).

Applies to **Applications** — hires recorded inside the app. The sheet-synced
joiners (`sheet_joinees`, `provisional_orders`) are not touched; they stay
read-only (step A).

## Decisions (user, 31-Oct-2026)

| # | Decision |
|---|---|
| Q1 (CONFIRM-4) | New status `PROVISIONAL_ORDER_ISSUED`, placed between `JOINED` and `DEPARTMENT_ROOM_ALLOTTED` in `APPLICATION_STATUS_ORDER`, and **required** for new moves: department allotment is refused unless the application is at `PROVISIONAL_ORDER_ISSUED`. Existing records keep their status. One permanent enum value (decision B, 29-Oct). |
| Q2 | Order number format: **as on the user's existing letters** — pending the sample. Until then the generator lives in one function in `reference_numbers.py` so the format is a one-line change. |
| Q3 | Letter wording/layout: **copied from the user's sample** — pending. Until then a clearly marked placeholder template; not deployed with it. |
| Q4 | Allotment offers **every department** (not only the 32 "new" ones), but only where Sanctioned Strength shows **vacancy > 0** for the application's designation, category and campus. Zero vacancy is refused unless a **Super Admin** overrides with a mandatory reason, which is audited. |

## Provisional order (per Application)

New table `appointment_orders` (named so it cannot be confused with the
sheet mirror `provisional_orders`): application, order number (unique),
order date, issued by, issued at, letter fields snapshot (name, designation,
category, campus, joining date, probation end), signed copy (object key,
content type, size, uploaded by/at), status `ISSUED` | `CANCELLED`.

- `POST /applications/{id}/provisional-order` — only from `JOINED`; creates
  the order, moves the application to `PROVISIONAL_ORDER_ISSUED` through
  `pipeline.transition_application_status` (the only status writer).
- `GET .../provisional-order/letter.pdf` — the generated letter.
- `POST .../provisional-order/signed-copy` — PDF/JPEG/PNG, magic bytes
  checked, 10 MB cap, stored like joining-document files (hard-fail 502 if
  storage is down).
- `GET .../provisional-order/signed-copy` — download.
- Every write audited with the actor. Role: `ONBOARDING` permission, same
  as the other joining steps; campus-scoped like them.

## Department allotment (existing step, rules added)

The existing `allot-department-room` step keeps its fields and route; added:

- **Options endpoint** `GET /applications/{id}/department-options`: every
  department with a Sanctioned Strength row for the application's
  designation + category on its campus, with sanctioned, working (existing
  `working_count_for`, no second counter), vacancy, and `suggested: true`
  when the candidate's specialisation / qualification text shares a keyword
  with the department name (simple word match, never auto-applied).
- **Allotment**: refused (409) when the chosen department's vacancy is 0,
  unless the caller is Super Admin and sends `override_reason` (required,
  audited as a separate event).
- Vacancy still drops at handover (Employee creation), not at allotment —
  decision D, 29-Oct. The options list counts other applications already
  allotted to the department and not yet handed over, so two people cannot
  be allotted the last seat (shown as "reserved").

## Screens

Onboarding / application detail, at `JOINED`: **Issue provisional order**
(shows the number and date, then Download letter, Upload signed copy). At
`PROVISIONAL_ORDER_ISSUED`: **Allot department & room** with the options
list (vacancy per department, suggested ones first and marked), zero-vacancy
options disabled, and a Super Admin "override" path with a reason box. The
Onboarding stage filter shows the new stage in its place.
