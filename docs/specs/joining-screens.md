# Joining screens (pipeline brief Phase 4, step A)

Status: AGREED 2026-10-31.

## Decisions (user, 31-Oct-2026)

| # | Decision |
|---|---|
| P1 | Phase 4 starts with **read-only screens for the synced sheet data**: New Joinees, Provisional Orders, New Departments (+ their faculty). The sheets stay the record; the app issues nothing that the sheet also tracks. The brief's order letter + department assignment on Applications comes after, for hires made inside the app. |
| P2 | Department assignment (later step) may offer **all departments**: the 32 approved ones and the 64 others the Faculty tab uses. |
| P3 (default) | Readers: Super Admin, HR Admin, Recruitment Coordinator — the Talent Pool's readers. All three are global-scope roles; the tables have no campus scoping need beyond a filter. |

## Data (already synced, read-only here)

`sheet_joinees` (1,226), `provisional_orders` (324), `new_departments` (32),
`department_faculty` (703) — see `docs/specs/joinee-order-sync.md`. Only
`is_active` rows by default, with a "show removed" toggle like the Talent
Pool. Mobile numbers are not stored, so none are shown.

## API (read-only, one router `app/api/v1/routers/joining_records.py`)

- `GET /joining-records/joinees/summary` — totals by category, by
  employment state, by campus, joined per month (last 12), flagged count,
  linked-to-talent-pool count.
- `GET /joining-records/joinees` — paged list; filters `q` (name, BIO ID,
  staff ID, designation, department), `category` (incl. `none`),
  `employment_state` (incl. `none`), `campus_code` (incl. `none`),
  `joined_month` (YYYY-MM or `undated`), `include_inactive`.
- `GET /joining-records/joinees/{id}` — detail incl. the linked Talent Pool
  entry (id, tab, status) and the provisional order if any.
- `GET /joining-records/orders/summary` — issued / pending, outcomes,
  **probation ending in the next 30 days**, **probation ended with no
  outcome** (overdue), unlinked to a joiner.
- `GET /joining-records/orders` — paged; filters `q`, `order_status`,
  `outcome` (incl. `none`), `probation` (`due30` | `overdue` | `ended`),
  `include_inactive`.
- `GET /joining-records/departments` — the 32 approved departments with
  approved Count, Additional Count, active members, of whom additional, HOD
  name(s), left / on leave; plus one line per **unmatched** Faculty
  department name with its member count.
- `GET /joining-records/faculty` — paged; filters `q`, `department`
  (approved name or raw unmatched name), `role`, `state`, `additional`,
  `matched` (true/false), `include_inactive`.

Every count a summary shows must equal the list it opens (same rule as the
Talent Pool; tests assert it).

## Screens

A **Joining** group in the sidebar, after Talent Pool / Selection Batches:

1. **New Joinees** — tiles (total, teaching, non-teaching, housekeeping, no
   category, left, rejoined, linked to Talent Pool), joined-per-month bars,
   by-campus list; all clickable into the list below (scrolls to it,
   "Showing: … · Clear filters"); list → side sheet with the detail.
2. **Provisional Orders** — tiles (issued, pending, permanent order
   received, probation extended, not recommended, **probation ending in 30
   days**, **overdue — no outcome**), clickable; list with order date,
   probation end, checklist (ID card, food app, Arms, 360 app, ADFA file),
   room, outcome.
3. **New Departments** — table of the 32 approved departments (approved,
   additional, active, gap) and the unmatched department names below;
   clicking a department lists its faculty (role, additional, state, Bio ID,
   linked joiner).

Same look as Talent Pool (reuse its components where they fit).

Also fixes: opening `/talent-pool?...#register` directly (a fresh page
load, not an in-page click) must scroll to the list once it has loaded.
