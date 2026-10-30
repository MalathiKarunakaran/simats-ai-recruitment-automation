# New Joinees + Pro App Order sync (pipeline brief Phase 2, S3–S5)

Status: AGREED 2026-10-30 (decisions below). Builds on the talent pool sync
(`docs/specs/talent-pool-sheet-sync.md`, S1/S2), which is live.

## Decisions (2026-10-30)

| # | Question | Decision |
|---|---|---|
| D1 | Transport (brief §2.2 wanted a service account) | **Apps Script**, as for S1/S2: saveetha.com blocks Google Cloud, so no service account exists. The script resolves headers inside Google and sends only allowlisted columns. |
| D2 | CONFIRM-8: `JRF` joiners (43) | Stored with `employee_type_raw = "JRF"`, **no category**, flagged. Nothing guessed. |
| D3 | CONFIRM-9: writes to Employees | **None.** Production has 0 Employees and `Employee` has no BIO ID, so every joiner is flagged "not in Employees". No Employee, Application or Sanctioned Strength row is created or changed. |
| D4 | S5 `New Depts Updated` | Not readable yet; the user shares it view-only, then headers + 10 rows are shown and the mapping approved **before** any S5 code. |
| D5 | Brief §2.10 admin page | **Status page + dry run.** Mappings and lookups stay in code (as for S1/S2); a UI editor for them is a later decision. |

## Sources (spreadsheet `1uYmjS-Wu4OlflinrGCmftDr_nXP01eVItCqqXfXi7pU`)

| Tab | Header row | Rows (30-Oct-2026) | Key |
|---|---|---|---|
| `New Joinees` | **row 2** (A1 holds a stray phone number) | ~1,230 | BIO ID → New BIoID → Staff ID → name + Joined On |
| `Pro App Order` | row 1 | ~333 | BioID (unique; EMPID repeats, e.g. `SSETSIT038` ×2) |

Headers are matched by name with case, spaces and punctuation ignored
(`send date `, `After Probation  Received AO ` carry stray spaces).

## S3 New Joinees — privacy first

**Allowlist only** (brief §2.7). The Apps Script reads the header row,
picks the allowlisted columns by name, and reads only those columns; the
server drops any other header it is sent before doing anything (defence in
depth). Never read: RBL Account number, Salary fixed, Allowance Details,
Gender, Current Work, S. No+ — nor any column added later.

`Mobile No.` is sent, used **only in memory** to link the joiner to a talent
pool row (last 10 digits), then discarded: not stored, not in `raw`, not in
flags, logs or exports. It is also NOT used for the fallback key (a hash of
a 10-digit number is trivially reversible); the last fallback is name +
Joined On instead.

Normalised (raw always kept beside it):

| Field | Rule |
|---|---|
| category | TS→TEACHING, NTS→NON_TEACHING, HK→HOUSEKEEPING, JRF→none + flag (D2), other→none + flag |
| campus | SSE SCLAS SCAD SSPE STUDIO SPIER SHIFT direct; SCALS→SCLAS; SHoTs, SNAPS, other→none + flag |
| employment_state | New→ACTIVE; Long Leave→ACTIVE + flag; Left/LEFT/Resigned/EXPIRED→LEFT; Rejoin/Rejoined/Rejoned/REJOIN→REJOINED; anything else (e.g. `Old`)→none + flag |
| dates | Joined On, Interview Date, Provisional Appointment Order Given Date, send date, Received date: DD-MM-YYYY, else raw only + flag |
| department | `Department` and `Dept New` stored as typed (mapping comes with S5 / Phase 4) |

Also flagged: no key at all, a key that repeats (rejoins are kept as their
own rows, never merged), "not in Employees" (D3, reported as a count).

## S4 Pro App Order

| Field | Rule |
|---|---|
| order_on | Order Date, DD-MM-YYYY |
| probation_end_on | Probation Period, **M/D/YYYY** (the one exception) |
| order_status | Issued/Generated→ISSUED; Not Issued or blank→PENDING |
| outcome | Received→PERMANENT_ORDER_RECEIVED; Extend Probation→PROBATION_EXTENDED; Not Satisfied→NOT_RECOMMENDED; blank→none; Left, Rejoin, TRA, Family Way, No Submit PG, Long Leave, other→none + flag |
| checklist | ID Card, Food App, Arms, 360 App, File Submitted to ADFA: raw text |
| room | Room Allotted as typed; "Left"→flag |
| link | to the S3 joiner with the same BIO ID, when there is one |

## Mechanics (same as S1/S2)

- `POST /api/v1/sheet-sync/{NEW_JOINEES|PRO_APP_ORDER}`, gated by the same
  shared secret header as the talent pool sync. One full snapshot per call.
- Idempotent: a row's identity is its key, not its row number; a second run
  changes nothing. Rows that leave the sheet are deactivated, never deleted.
- `dry_run: true` computes everything, rolls the data back, and still
  records the run, so the preview shows on the status page.
- `sheet_sync_runs`: source, when, dry run or not, counts, flagged rows
  (row number, key, reason — never a cell value outside the allowlist).
- Only these two new tables (`sheet_joinees`, `provisional_orders`) and
  `sheet_sync_runs` are ever written. Normalised states are strings, not new
  Postgres enum values, so the migration stays fully reversible.

## Status page (Super Admin)

Administration → **Google Sheet Sync**: one card per source S1–S5 with the
last run (time, counts, flagged), a flagged-rows Excel download, and the
last dry run. S5 shows "waiting for mapping approval".

## Build order (one commit each)

1. This spec.
2. Backend: models, migration, normaliser, sync service, endpoint, tests —
   including a test that feeds the excluded columns and asserts none of
   their values reach any table, flag, log line or export.
3. Apps Script: S3/S4 added to the existing sync script, allowlist resolved
   inside Google, dry-run functions.
4. Status page + runs endpoint + flagged Excel.
5. Deploy (needs the user's go-ahead), then the user updates the script.
6. S5, after its mapping is approved.
