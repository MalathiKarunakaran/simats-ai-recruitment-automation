# Talent Pool sheet sync

**Status: AGREED (2026-10-29); open questions resolved in §7.** Rebuilt from the live sheet because the
original version of this spec was never committed. Every count below was taken
from the sheet on 2026-10-28 ("Last Date Update 28-10-2026 04.31 pm").

`docs/specs/talent-pool-dashboard.md` covers the read API and the page. This
file covers the only writer of `talent_pool_entries`: the sync.

## 1. Source

Google Sheet **"SIMATS Recruitment_New 15-04-2025"**
(`1z8clcWd3oMs_Ipm8UPpxzgz9ZyEdhinw5i7xdQ8Ek24`). Two tabs only:

| Tab (exact name) | `source_tab` | Header row | Data rows | Candidates (rows with a name) |
|---|---|---|---|---|
| `Final ` (trailing space) | `TEACHING_FINAL` | 2 | 3 onward | 7,736 |
| `NTS` | `NTS` | 1 | 2 onward | 2,763 |

All other tabs, including `TS`, are ignored. NTS reports 11,705 grid rows,
but everything after the last candidate is empty.

`sheet_last_update` comes from `Final `!C1 and D1 and is stored as
`"<C1>, <D1>"`, for example `"28-10-2026, 04.31 pm"`. NTS has no such cell, so
the value is null for NTS.

## 2. Transport

An n8n workflow runs **every 15 minutes**. It reads each tab with the Google
Sheets node and sends **one POST per tab** to:

```
POST /api/v1/talent-pool/sync
X-Talent-Pool-Sync-Secret: <TALENT_POOL_SYNC_SECRET>
{
  "source_tab": "TEACHING_FINAL",
  "sheet_last_update": "28-10-2026, 04.31 pm",
  "headers": ["S.No", "Data", ...],
  "rows": [ { "row_number": 3, "cells": ["1", "Mam Data", ...] }, ... ]
}
```

- **Every POST is a full snapshot of the tab.** The app works out what was
  inserted, changed and removed. n8n does no logic.
- **The secret gate is the same as `require_mail_intake_secret`.** The secret
  is compared in constant time. If `TALENT_POOL_SYNC_SECRET` is empty, the
  endpoint refuses every request with 503. The actor is `None`.
- **Size:** the Final payload is about 1.6 MB, so the request body limit must
  allow at least 5 MB.
- **Atomicity:** the whole tab is applied in one transaction. A failed sync
  changes nothing, and the page keeps showing the previous sync's data.

## 3. Column mapping

The `raw` field keeps every column of the row as header → value. The register's
"All columns" section relies on it.

**Final ** (Teaching)

| Sheet column | Field | Rule |
|---|---|---|
| E Name | `full_name` | Trimmed. **Blank → row skipped** and reported (36 today). |
| D Mail ID | `email` | Trimmed. Blank → null (148 today). |
| F Phone Number | `phone` | Trimmed, kept as text. |
| B Data | `source` | As typed: Mam Data 5,125, Our Data 2,611. |
| C Applied Date | `applied_on` | §4.4 |
| G Actual Dept | `dept_raw`, `dept_group` | §4.3 and Appendix A |
| I PhD / Eligible Status | `eligibility_raw`, `eligibility` | §4.2 |
| N Status | `sheet_status` | §4.1 |
| O Date of Interview | `interview_on_raw` | As typed. |
| Q General Remark | `remarks` | As typed. |
| S Interview Called by | `called_by` | As typed. |
| H Google Link | `resume_url` | As typed. The page links it only if it starts with `https://` (6,130 rows today). |

**NTS** (Non-teaching)

| Sheet column | Field | Rule |
|---|---|---|
| B Name | `full_name` | Blank → row skipped (0 today). |
| D Mail ID / C Phone No | `email` / `phone` | Trimmed. |
| E Applied Post | `applied_post` | As typed (351 spellings, e.g. Hostel Warden 427). |
| F Department | `dept_raw`, `dept_group` = trimmed `dept_raw` | Blank on 2,449 of 2,763 rows → "Not set" (decided, §7 Q3). |
| H Reference | `source` | Indeed 1,619, Direct, Mail, LinkedIn, … |
| I Call Date / Mail Sent Date | `applied_on` | §4.4, falling back to K |
| K Interview Scheduled Date | `interview_on_raw` | As typed. |
| M General Remark + O Remarks | `remarks` | Non-blank parts joined with " · ". |
| R Final Status (+ N Status) | `sheet_status`, `status_from_remark` | §4.1 |

NTS has no `eligibility` and no `called_by` (both null).

## 4. Normalisation

All matching ignores case and treats repeated spaces as one.

### 4.1 Status

**Teaching (column N).** The column mixes interview outcomes with screening
results:

| Sheet value | `sheet_status` | Today |
|---|---|---|
| Selected | `Selected` | 455 |
| Joined | `Joined` | 233 |
| Waiting List | `Waiting List` | 178 |
| Rejected | `Rejected` | 1,501 |
| Eligible, blank | `Pending` | 2,480 + 1,400 |
| Not Eligible | `Not Eligible` | 812 |
| No Resume Link | `No Resume Link` | 642 |
| Not Valid | `Not Valid` | 35 |
| anything else | stored as typed | 0 |

**Decided: Joined counts as Selected.** The read side changes in one place
(sync step 2, below):
- `TALENT_POOL_SELECTED_STATUSES = ("Selected", "Joined")` drives the Selected
  tile, the department table's Selected column and the monthly "selected" bar.
- `Joined` joins `TALENT_POOL_DECIDED_STATUSES`.

Joined still shows as its own status in the register and its filter.
Selected tile today: 688. "% of interviewed":
688 ÷ (688 + 178 + 1,501) = 29%.

**NTS.** Use column R `Final Status` as typed: Rejected 515, RNR 505,
Not Interested 275, On Hold 121, Selected 56, Waiting List 36,
Interview Scheduled 27.

When R is blank, check column N:
- If N is exactly selected, rejected, waiting list, RNR or not interested (any
  case, "Not Intrested" included), use that status and set
  `status_from_remark = true`.
- Otherwise the status is `No outcome`.

**Decided as asked, but it has no effect today.** Every row with a status word
in N also has R filled in, so the fallback rescues 0 rows and the 1,228 blank-R
rows all become `No outcome`. It is about five lines of code; drop it if you
prefer.

### 4.2 Eligibility (Teaching only)

| `eligibility` | Sheet spellings | Today |
|---|---|---|
| `With Ph.D` | With Ph.D, With PH.D, With ph.D | 4,223 |
| `Thesis / viva stage` | Thesis Submitted/submitted, Synopsis Submitted, Waiting for Viva | 307 |
| `Pursuing Ph.D` | Pursuing Ph.D, Pursuing PH.D | 481 |
| `No Ph.D` | No Ph.D, No PH.D, No Ph.d | 879 |
| `Not eligible` | Not Eligible, No PG, Pursuing PG | 504 |
| null ("Not set") | blank, "NTS" (6), "No Resume" (2), anything unrecognised | 1,342 |

`eligibility_raw` keeps the cell as typed. The 6 "NTS" rows look like
non-teaching candidates on the teaching tab. The sync reports them (§5) and
does not move them.

### 4.3 Department groups (Teaching)

258 spellings (220 when case is ignored) map to **38 groups plus "Not set"**.
The full table is in Appendix A. Matching rules:
- The lookup key is the spelling lower-cased, with punctuation turned into
  spaces.
- Rules are checked in Appendix A's order and the **first match wins**. The
  order matters: "B.ED - CSE" is Education, not CSE, and "E&I - BME" is
  Biomedical.
- A spelling no rule matches goes to "Not set" and is listed in the sync
  response under `unmapped_departments`. A new spelling therefore shows up
  instead of quietly landing in the wrong group.

The CSE group includes IT, MCA, BCA, CS and M.Sc CS/IT, as the dashboard spec
requires: 783 rows today.

### 4.4 Dates → `applied_on`

| Tab | Formats seen | Rule |
|---|---|---|
| Final, C | `DD-MM-YYYY` (4,309), **`M/D/YYYY H:MM:SS`** (1,073, Google Form timestamps; the second number goes above 12 in 748 rows and the first never does), `#N/A` (2,330, almost all "Our Data"), blank (23) | Parse the first two; `#N/A`/blank → null. These rows count as "undated" on the page. |
| NTS, I then K | `DD-MM-YYYY`, `D-M-YYYY`, **`DD/MM/YYYY`** (day first here; the first number goes above 12 in 45 rows and the second never does), `Mailed on DD-MM-YY[YY]`, `DD.M.YY`; text like "Need to call", "Direct" | Parse the date out of column I. If that fails, use column K. If both fail, null. |

**Slash dates mean opposite orders on the two tabs.** One shared parser would
silently swap day and month on one of them, so each tab gets its own parser,
with a test for each.

## 5. Identity, upsert and removal

- **Row key:** `source_tab` + person + occurrence.
  - Person = lower(email). If there is no email, lower(name) + phone digits.
  - Occurrence = 1, 2, … in sheet order, for repeats of the same person.
  - This keeps a row's identity when the sheet is re-sorted or rows are
    inserted. Row number would not.
  - Stored in a new `row_key` column with a unique constraint on
    (`source_tab`, `row_key`). The model's docstring leaves this choice to the
    sync.
- **Duplicates are kept** (decided). 53 extra email repeats in Final and 104
  extra name + phone repeats in NTS are each stored as their own row, so the
  page counts match the sheet row for row. They are listed in the response.
- **Changes:** `content_hash` = SHA-256 of the row's cells. If the hash is
  unchanged the row is not written. If it changed, the row is updated in place.
- **Removed from sheet:** a key missing from the snapshot gets
  `is_active = false`. It is not deleted. If it comes back, it is
  reactivated.
- **Response** (also written as `after_state` on the `TALENT_POOL_SYNCED` audit
  row, which the summary endpoint already reads):

```json
{
  "source_tab": "TEACHING_FINAL",
  "sheet_last_update": "28-10-2026, 04.31 pm",
  "counts": {"received": 7772, "inserted": 0, "updated": 0, "unchanged": 0,
             "deactivated": 0, "skipped": 36, "duplicates": 53},
  "skipped_rows": [ {"row_number": 140, "reason": "no name"} ],
  "duplicate_rows": [ {"row_number": 812, "same_as_row": 77} ],
  "unmapped_departments": [],
  "notes": [ {"row_number": 4410, "note": "eligibility says NTS"} ]
}
```

The `counts` object holds integers only, because the summary endpoint drops
anything else. The lists are capped at 200 entries each.

## 6. Build steps (one commit each, stop after each)

1. **Normaliser.** Pure functions for status, eligibility, department group
   (Appendix A as a Python table) and the two date parsers, in
   `app/services/talent_pool_normalise.py`. Unit tests use the real spellings
   above. No database involved.
2. **Sync endpoint.**
   - Migration adds `row_key` + the unique constraint.
   - Secret gate, `TALENT_POOL_SYNC_SECRET` in config and `.env.example`.
   - `services/talent_pool_sync.py`, the audit row, and the `Joined` read-side
     change from §4.1.
   - Tests: insert, unchanged, update, deactivate, reactivate, skip,
     duplicate, 503 with no secret, 401 with a wrong secret.
   - Checked by hand, because the suite cannot see a missing `db.commit()`
     (CLAUDE.md): post the same snapshot twice to a live uvicorn and get
     `unchanged` = all rows.
3. **n8n workflow + production.** The workflow JSON is committed for
   reference, the secret is set on the VPS, and the first run's response is
   recorded. After that, dashboard spec Step E (verify against the Recruitment
   Desk dashboard) can run.

## 7. Decisions (2026-10-29)

- **Q1. Pending column: yes.** Teaching `Eligible` + blank → `Pending`
  (3,880 rows) feeds the "Eligible, no decision" tile. Not Eligible, No Resume
  Link and Not Valid keep their own names and still count as "Pending/Open"
  in the department table, because that column means "not decided".
- **Q2. Keep all 38 groups.** No "Other" bucket. Appendix A stands as written.
- **Q3. NTS groups by Department as is.** "Not set" will be the largest row.
  Grouping by Applied Post is a possible later step, not part of this build.
- **Q4. No date fallback.** `#N/A` and blank become null `applied_on`; the
  "Month / Year" column is not read.

## Appendix A: Teaching department groups

Rows counted on 2026-10-28. Checked top to bottom; first match wins.

| Group | Rows | Spellings in the sheet (count) |
|---|---:|---|
| ECE | 1028 | ECE 1024 ; ECE TRA 4 |
| Mechanical | 983 | Mechanical 755 ; MECH 221 ; Mech 3 ; ITI MECH 1 ; MECH RESEARCH 1 ; ITI (WELDER) 1 ; Marine Engineering 1 |
| CSE | 783 | CSE 659 ; MCA CSE 42 ; IT 19 ; M.SC CSE 12 ; MCA 11 ; MCA, CSE 6 ; B.SC, M.SC, CSE 4 ; M.Sc CS 3 ; MCA PHD 2 ; CSE TRA 2 ; MCA,CSE 2 ; CS 2 ; CSE,MS 1 ; M.Sc CSE 1 ; B.CS, M.SC CS 1 ; MTech IT 1 ; M.SC IT 1 ; B.SC, M.SC CSE 1 ; B.SC, M.SC CS 1 ; BCA 1 ; B.SC, M.SC IT 1 ; MCA , Ph.D CS 1 ; M.SC CS 1 ; B.SC, CSE 1 ; M.SC, CSE 1 ; B.SC CS 1 ; BCA, M.SC IT 1 ; MSC CSE 1 ; CSE IT 1 ; ECE.ME,Ph.D CSE 1 ; Computer Science 1 |
| EEE | 645 | EEE 640 ; EEE Research 1 ; B.SC, M.SC, ENEE 1 ; EEE TRA 1 ; B.SC, EEE 1 ; ENEE 1 |
| Maths | 638 | MATHS 471 ; Maths 164 ; Statistics 3 |
| Biotechnology | 548 | B.SC, M.SC BT 187 ; BT 164 ; Biotechnology 146 ; B.SC, M.SC, BT 17 ; B.SC, M.SC,BT 16 ; B.Sc, M.Sc BT 7 ; M.SC BT 3 ; B/SC, M.SC BT 3 ; Biotechnlogy 3 ; B.SC , M.SC BT 1 ; BT TRA 1 |
| Civil | 540 | CIVIL 338 ; Civil 202 |
| Chemistry | 525 | CHEMISTRY 350 ; Chemistry 173 ; chemistry 1 ; Chemisty 1 |
| Physics | 470 | PHYSICS 255 ; Physics 214 ; Phyics 1 |
| English | 208 | ENGLISH 200 ; English 7 ; ENGLIGH 1 |
| Architecture | 110 | ARCHITECTURE 66 ; M.Arch 22 ; M.ARCH 14 ; ARCHITECURE 2 ; B.ARCH 2 ; M.Arch Phd 1 ; ARCHITECTURE PHD 1 ; B.Arch 1 ; Architecture 1 |
| Soft Skills & Aptitude | 89 | SOFT SKILL 33 ; APTITUDE 13 ; Tech Trainer 11 ; Softskill 8 ; TECH TRAINER 7 ; Technical trainer 5 ; SOFTSKILL 3 ; Soft Skill 2 ; Softskill Trainer 2 ; Placement Training 1 ; Technical Trainer 1 ; Apptitude 1 ; Aptitude Trainer 1 ; Soft 1 |
| Biomedical | 83 | BME 63 ; Biomedical 14 ; BMA TRA 1 ; BME TRA 1 ; E&I - BME 1 ; Medical Electronics 1 ; B.SC,M.SC,BME 1 ; EEE / BME 1 |
| Foreign Languages | 80 | FRENCH 31 ; JAPANESE 21 ; GERMAN 19 ; French 3 ; KOREAN 2 ; Foreign Language 2 ; Chinese 1 ; Japanese 1 |
| Design | 73 | FASHION DESIGN 27 ; M.DES 9 ; MDES 7 ; DESIGN 6 ; Fashion Design 4 ; B.DES 4 ; INTERIER DESIGN 3 ; Design 3 ; B.DES, MFT 1 ; DESIGNER 1 ; GRAPHIC DESIGN 1 ; M.Des - Interior Design 1 ; B. Voc Fashion Technology 1 ; M. Des 1 ; M.Des 1 ; Textile Technology 1 ; B.Des 1 ; M.Sc Interior 1 |
| Commerce | 72 | COMMERCE 62 ; B.COM 5 ; Commerce 3 ; M.COM 1 ; B.COM, MBA 1 |
| Bioinformatics | 67 | Bioinformatics 19 ; B.SC, M.SC, BI 18 ; BI 15 ; B.SC, M.SC BI 8 ; BIOINFORMATICS 4 ; M.SC BI 1 ; B.Sc, M.Sc, BI 1 ; B.SC, M.SC,BI 1 |
| Fine Arts & Media | 60 | ANIMATION 16 ; VISCOMM 13 ; MFA 6 ; BHARATHAM 3 ; 3D ANIMATION 3 ; VISCOM 3 ; FINE ARTS 3 ; BFA 3 ; FINE ART 2 ; Viscom 2 ; CONTENT MAKER 1 ; PHOTOGRAPHER 1 ; BFA, MVA 1 ; MUSIC 1 ; MEDIA 1 ; Media Arts 1 |
| Management | 57 | MBA 53 ; MANAGEMENT 1 ; BBA, MBA 1 ; BBA 1 ; Management 1 |
| Hotel & Tourism | 53 | Hotel Management 19 ; Tourism Management 16 ; HOTEL 7 ; HOTEL MGT 6 ; Diploma Hotel Management 2 ; Hotel MGT 2 ; B.COM, MBA (TOURISM) 1 |
| Life Sciences | 40 | Zoology 17 ; Botany 8 ; Biology 7 ; B.SC, M.SC, BOTANY 1 ; Plant Biology 1 ; Fisheries Science 1 ; B.SC ZOOLOGY 1 ; Biological Science 1 ; Marine Science 1 ; Fishery Science 1 ; Plant pathology 1 |
| Education | 39 | Education 7 ; B.ED - ZOOLOGY 4 ; B.ED - CSE 4 ; B.ED ZOOLOGY 3 ; B.ED - HISTORY 3 ; B.ED - MATHS 3 ; B.ED - TAMIL 2 ; B.ED - ENGLISH 2 ; B.ED PHYSICS 2 ; B.ED CHEMISTRY 2 ; B.ED MATHS 2 ; B.ED - CS 1 ; B.ED GEOLOGY 1 ; B.Ed English 1 ; EDUCATION 1 ; B.ED SOCIALOGY 1 |
| Biochemistry | 30 | Biochemistry 28 ; BioChemistry 2 |
| Microbiology | 24 | Microbiology 24 |
| Chemical | 23 | CHEMICAL 12 ; Chemical Engineering 10 ; Chemical Eng 1 |
| Physical Education & Yoga | 22 | SSPE 11 ; Yoga 4 ; Physical Education 3 ; YOGA 3 ; PHYSICAL EDUCATION 1 |
| Geology & Environment | 19 | B.SC, M.SC GEOLOGY 11 ; GEOLOGY 3 ; Geology 2 ; Environment Sciences 2 ; Geo Informatics 1 |
| Library | 17 | Librarian 13 ; LIBRARIAN 2 ; BLIS LIBRARIAN 2 |
| Tamil | 17 | TAMIL 17 |
| E&I | 12 | E&I 10 ; ICE 1 ; EIE 1 |
| Food & Nutrition | 10 | Nutrition 3 ; NUTRITION 2 ; Food Technology 2 ; B.SC, M.SC FOOD 1 ; HOME SCIENCE 1 ; Food Science 1 |
| Aeronautical | 10 | AERONATICAL 6 ; Aeronatical 1 ; AEROSPACE 1 ; Aeronautical 1 ; Aeronautical Engineering 1 |
| Agriculture | 7 | AGRI 4 ; Agriculture 2 ; HORTICULTURE 1 |
| Allied Health | 7 | Pharmacy 2 ; B.Pharm 1 ; Emergency Care Technology 1 ; Optometry 1 ; Anesthesia technology 1 ; Neurology 1 |
| Placement | 6 | PLACEMENT 4 ; PLACEMENT OFFICER 2 |
| Polymer & Plastic Tech | 5 | POLYMER TECH 3 ; PLASTIC TECH 1 ; POLYMER SCIENCE 1 |
| Economics & Social Sciences | 5 | ECONOMICS 3 ; B.A SOCIALOGY 1 ; Economics 1 |
| Nanotechnology | 4 | Nanotech 1 ; Nano technology 1 ; Nanotechnology 1 ; Nano Science 1 |
| Not set | 327 | blank 318 ; No Resume 5 ; INVALID 1 ; B.SC, M.SC Ph.D 1 ; With Ph.D 1 ; Admin 1 |
