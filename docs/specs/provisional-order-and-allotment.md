# Provisional order + department allotment (pipeline brief Phase 4, step B)

Status: AGREED 2026-10-31. Letter and number taken from the user's own
register and AutoCrat template (sheet `1OKk4UdYxFJDLNqFihlX3-_NmL123xFCXYPdwRRKiAg0`,
template doc `1PCXfrzt6uUrvfLyCS_FEdVay9KhuziPVEKRTMLIa96s`).

Applies to **Applications** — hires recorded inside the app. The sheet-synced
joiners (`sheet_joinees`, `provisional_orders`) are not touched; they stay
read-only (step A).

## Decisions (user, 31-Oct-2026)

| # | Decision |
|---|---|
| Q1 (CONFIRM-4) | New status `PROVISIONAL_ORDER_ISSUED`, placed between `DEPARTMENT_ROOM_ALLOTTED` and `ORIENTATION_COMPLETE` in `APPLICATION_STATUS_ORDER`: **allot the department first, then issue the order**, so the letter prints the department actually allotted (the paper register fills Dept at order time). Flow: `JOINED` → `DEPARTMENT_ROOM_ALLOTTED` → `PROVISIONAL_ORDER_ISSUED` → `ORIENTATION_COMPLETE` → `HANDED_OVER_TO_HOD`. **Required** for new moves: orientation is refused unless the application is at `PROVISIONAL_ORDER_ISSUED`. Existing records keep their status; one already past the order step is untouched, one left at `DEPARTMENT_ROOM_ALLOTTED` needs its order before orientation. One permanent enum value (decision B, 29-Oct). *Revised by the user 31-Oct: the first version placed the order before allotment; nothing of it had been deployed, so the migration was edited in place.* |
| Q2 | Order number as on the existing letters: `‹campus code› / PA/ ‹NNN›/ ‹MM›/ ‹YYYY›`, e.g. `SSE / PA/ 231/ 10/ 2026`. NNN is a 3-digit running number **per campus that does not restart by year** (SSE ran 001→230 over 2025–26). The app continues after the paper register: floors per campus as of 31-Oct-2026 — SSE 230, SCLAS 027, SCAD 022, STUDIO 009, SSPE 003, SHoTS 003, SPIER 001. The register itself has duplicates and gaps (e.g. SSE 059, 074, 082 twice); the app's UNIQUE(campus, sequence) prevents that. |
| Q3 | Letter: the AutoCrat template's wording, word for word — order date, name, address, designation ("Grade"), department (the one allotted), college name; three-month probation; signed by Dr. K. Malathi, Associate Dean of Recruitment, and the campus Principal. College name + Principal per campus kept in one editable table in the letter module. |
| Q5 (31-Oct) | Candidates get a nullable postal **address** (multi-line), entered by staff on the candidate form — never on the public careers apply form. The letter prints it under the name like the template ("To, ‹Name›., ‹Address›"), one line per line; no address, no line. |
| Q4 | Allotment offers **every department** (not only the 32 "new" ones), but only where Sanctioned Strength shows **vacancy > 0** for the application's designation, category and campus. Zero vacancy is refused unless a **Super Admin** overrides with a mandatory reason, which is audited. |

## Provisional order (per Application)

New table `appointment_orders` (named so it cannot be confused with the
sheet mirror `provisional_orders`): application, order number (unique),
order date, issued by, issued at, letter fields snapshot (name, address,
designation, category, campus, allotted department, joining date, probation
end), signed copy (object key,
content type, size, uploaded by/at), status `ISSUED` | `CANCELLED`.

- `POST /applications/{id}/provisional-order` — only from
  `DEPARTMENT_ROOM_ALLOTTED`; body `{order_date?, address?}`. Creates the
  order with the allotted department's name, moves the application to
  `PROVISIONAL_ORDER_ISSUED` through `pipeline.transition_application_status`
  (the only status writer). `address` omitted = the candidate's own; the
  value used is snapshotted on the order and, if the candidate had none,
  saved to the candidate too (an existing one is never overwritten).
- `GET .../provisional-order/letter.pdf` — the generated letter.
- `POST .../provisional-order/signed-copy` — PDF/JPEG/PNG, magic bytes
  checked, 10 MB cap, stored like joining-document files (hard-fail 502 if
  storage is down).
- `GET .../provisional-order/signed-copy` — download.
- Every write audited with the actor. Role: `ONBOARDING` permission, same
  as the other joining steps; campus-scoped like them.

## Department allotment (existing step, rules added)

The existing `allot-department-room` step keeps its fields and route, and
runs from `JOINED` again (before the order); added:

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
  allotted to the department and not yet handed over (allotted, order
  issued, or oriented), so two people cannot be allotted the last seat
  (shown as "reserved").

## Screens

Onboarding / application detail (order revised 31-Oct), at `JOINED`:
**Allot department & room** with the options list (vacancy per department,
suggested ones first and marked), zero-vacancy options disabled, and a Super
Admin "override" path with a reason box. At `DEPARTMENT_ROOM_ALLOTTED`:
**Issue provisional order**, with an "Address on the letter" box prefilled
from the candidate and editable. From `PROVISIONAL_ORDER_ISSUED` on: the
order (number, date, department, probation end) with Download letter and
Upload / View signed copy, and at `PROVISIONAL_ORDER_ISSUED` **Mark
orientation complete**. The Onboarding stage filter shows the new stage in
its place (after Department room allotted).

Candidate create / edit form: an optional multi-line **Address** box; the
candidate detail page shows it.
