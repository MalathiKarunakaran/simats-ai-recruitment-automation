# Selection list to the University (pipeline brief Phase 3)

Status: DRAFT 2026-10-31 — decisions D1–D2 taken, D3–D6 proposed.

## Why this differs from the brief

The brief puts "Send to University" on **Applications** in status SELECTED.
Production has **0 Applications**: by decision A (2026-10-29) the sheets
feed the Talent Pool, and that is where the selected people are — 454
"Selected" in Final, 150 in NTS (31-Oct-2026). A selection list built on
Applications would be empty. So:

| # | Decision |
|---|---|
| D1 (user, 31-Oct) | A Selection Batch picks **Talent Pool rows whose sheet status is Selected**. No Application is created; the sheet stays the source of each person's status. |
| D2 (user, CONFIRM-2) | The University returns a formal approval: a batch records **University approved** with its reference number and date. |
| D3 (proposed) | Batch status lives on the batch (`SENT_TO_UNIVERSITY` → `UNIVERSITY_APPROVED`, or `WITHDRAWN`), as strings in a new table. **No new `ApplicationStatusEnum` value** — nothing irreversible is added, since no Application is involved. |
| D4 (proposed) | A person can be in only one batch that is not withdrawn; the picker shows "already in SB-2026-004" instead of letting them be sent twice. |
| D5 (proposed) | Who can create a batch and record the approval: Super Admin, HR Admin, Recruitment Coordinator (the coordinators work these sheets). |
| D6 (proposed, CONFIRM-3) | **Intimation to candidates is deferred.** The brief reuses the Offer flow, which needs an Application; with Talent Pool rows there is none. Revisit when Phase 4 decides how a selected person becomes an employee record. |

## Data

`selection_batches`: batch number `SB-YYYY-NNN` (count-this-year, like
`reference_numbers.py`), created by / at, note, status, sent on,
university reference no., university approved on, approved recorded by.

`selection_batch_members`: batch, talent pool entry, and a **snapshot** of
the list's columns taken when the batch is created (the sheet keeps
changing; the list sent to the University must not):

| List column (brief) | Source |
|---|---|
| Name | `full_name` |
| Designation | NTS: `applied_post`; Final: none in the sheet → typed per person in the dialog (optional) |
| Department | `dept_group` (Final), `dept_raw` (NTS) |
| Category | Final → Teaching, NTS → Non-teaching |
| Campus | not in the sheet → chosen once per batch (optional) |
| Qualification | `eligibility_raw` (e.g. "With Ph.D") |
| Experience | not in the sheet → blank |
| Panel remarks | `remarks` |
| Proposed salary | not in the sheet → optional per person in the dialog |

Every write goes through one service and writes an activity-log entry.

## Screens

1. **Talent Pool register**: when filtered to Selected, a checkbox per row
   and a **Send to University** button → dialog (campus, note, optional
   designation / proposed salary per person) → creates the batch.
2. **Selection Batches** page: list (number, date, people, status), detail
   with the members, **Download Excel** and **Download PDF**, and
   **Record University approval** (reference no. + date) or **Withdraw**.

## Build order

1. This spec (approved by the user).
2. Backend: tables + migration, service, endpoints, Excel + PDF, tests.
3. Frontend: register selection + dialog, Selection Batches page, tests.
4. Deploy (user's go-ahead).
