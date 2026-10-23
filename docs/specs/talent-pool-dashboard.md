# Spec: Talent Pool dashboard page in Hermes

Place this file at `docs/specs/talent-pool-dashboard.md` in the Hermes repo.

Start each Claude Code session with:
"Read docs/specs/talent-pool-dashboard.md, docs/specs/talent-pool-sheet-sync.md and CLAUDE.md. Report any conflict with the codebase before writing code. Do only the step I name, then stop."

Written against repo commit `1d66100` (2026-09-24).

---

## 0. Where this fits

This page brings the "Recruitment Desk" dashboard (built in Claude on 2026-10-21) into app.malathi.io. It reads **only** Hermes's own `talent_pool_entries` table. It never calls Google Sheets or Gmail.

**Prerequisite:** Steps 1 and 2 of `docs/specs/talent-pool-sheet-sync.md` are merged. That means the table, the normaliser (department groups, eligibility, statuses) and the sync endpoint exist. This file replaces section 6 ("Read API and Talent Pool page") of that spec with a fuller version. If the two disagree, this file wins for the read API and the page.

**Out of scope:**
- The recruitment-mail panel. Hermes has no mailbox access; that comes with the separate recruitment inbox agent.
- "Move to application", which is Step 4 of the sync spec.
- Any editing of pool entries. The page is read-only.

---

## 1. What the page must show

Route `/talent-pool`, nav item **"Talent Pool"** in the **Recruitment** nav group of `frontend/src/components/layout/AppShell.tsx`, visible to HR_ADMIN and SUPER_ADMIN only (same visibility pattern as "Import Data"). Use a lucide icon such as `Database`.

Layout, top to bottom:

```
[Header]  Talent Pool                         [Teaching | Non-teaching]  [Refresh]
          Synced from Google Sheet · last sync 21 Oct, 17:00 · sheet last updated 14-10-2026, 04.51 pm
[Stale-sync warning, only when last sync > 60 min ago]
[Tiles row]
[Candidates per month (12-month bar chart)] [By department table + Grouped/As-in-sheet toggle]
[Three breakdown panels]
[Candidate register: search + filters + paginated table]
```

### 1.1 Category toggle

- Two options: Teaching (`source_tab=TEACHING_FINAL`) and Non-teaching (`source_tab=NTS`). Default Teaching.
- Keep the choice in the URL query (`?tab=nts`) so a link opens the same view.
- Switching the tab clears the register filters.

### 1.2 Tiles

All counts use active entries only (`is_active = true`).

**Teaching:**

| Tile | Value | Sub-line | Click action |
|---|---|---|---|
| Total candidates | count | "in the Final sheet" | none |
| Selected | `sheet_status = Selected` | "N% of interviewed", where N = Selected ÷ (Selected + Waiting List + Rejected), rounded | filter status = Selected |
| Waiting list | `Waiting List` | — | filter status |
| Rejected | `Rejected` | — | filter status |
| Pending | `Pending` | "no decision recorded" | filter status |
| Eligible (With Ph.D) | `eligibility = With Ph.D` | "+N at thesis / viva stage" | filter eligibility = With Ph.D |
| Eligible, no decision | `With Ph.D` AND `Pending` | "With Ph.D, not yet interviewed" | filter eligibility + status |

**Non-teaching:**

| Tile | Value | Sub-line | Click action |
|---|---|---|---|
| Total candidates | count | "in the NTS sheet" | none |
| Selected | `Selected` | "N% of decided" | filter |
| Waiting list | `Waiting List` | — | filter |
| Rejected | `Rejected` | — | filter |
| In follow-up | `RNR` + `On Hold` + `Interview Scheduled` | "RNR n · On hold n" | none |
| Not interested | `Not Interested` | — | filter |
| No outcome | `No outcome` | "date or note only" | filter |

- Tiles that filter are buttons with a visible focus state. Clicking one sets the register filters and scrolls to the register.
- Reuse `components/dashboard/StatTile.tsx` if its props allow a click handler and sub-line; otherwise extend it without breaking existing callers (keep `StatTile.test.tsx` green).

Colour by state, not decoration:
- Selected: success colour
- Waiting list: warning colour
- Rejected: danger colour
- Pending / No outcome / Not interested: neutral
- Eligibility tiles: the brand accent

Use the existing theme tokens in `frontend/src/theme` and `index.css`; do not add new hex values.

The **definition of "eligible"** lives in one backend constant, `ELIGIBLE_VALUES = ("With Ph.D",)`, returned to the frontend in the summary response (`eligible_definition`). The tile label is built from it. Open policy question: whether "No Ph.D" also counts for Assistant Professor posts. Changing the constant must be the only change needed.

### 1.3 Candidates per month

- Vertical bar chart (recharts, already a dependency; follow `CategoryBarChart.tsx` styling).
- Last 12 calendar months ending with the current month, grouped by `applied_on`.
- Each bar is the count added that month. Inside it, a darker overlaid segment shows how many of them are `Selected`. Legend: "Added", "Selected".
- Tooltip on hover: "Oct 2026: 120 added, 9 selected".
- Value label on top of each bar.
- Below the chart: "N rows have no readable date and are not counted here."
  - Teaching dates come from Applied Date.
  - NTS dates come from Call / Mail Sent Date, or the interview date when that is blank.

### 1.4 By department

- A table with columns Department, Total, Eligible (teaching only), Selected, Waiting, Rejected, and Pending (teaching) / Open (NTS). Open counts every status other than Selected, Waiting List and Rejected.
- Sorted by Total, descending. A small inline bar after the name shows Total relative to the largest row.
- Teaching only: a two-option toggle **Grouped** / **As in sheet**.
  - Grouped uses `dept_group` (Appendix A of the sync spec, about 33 groups).
  - As in sheet uses `dept_raw` exactly as typed (about 260 values; blank shows as "Not set").
  - Sub-line: "33 groups made from Actual Dept for counting (CSE includes IT, MCA, BCA, CS). Your sheet is unchanged." or "260 departments exactly as typed in Actual Dept."
  - Remember the toggle in `localStorage` (wrap in try/catch).
- NTS: no toggle. Use `dept_group`, which for NTS is the trimmed department name.
- Clicking a row (or Enter on a focused row) sets the register's department filter to that value and scrolls to the register.
- The table scrolls inside its own container on narrow screens.

### 1.5 Breakdown panels (three side by side, stacked on mobile)

Each panel is a ranked list: label, count, thin horizontal bar. It shows the top 8 and folds the rest into "Others".

| Teaching | Non-teaching |
|---|---|
| **PhD / eligibility**, in fixed order: With Ph.D, Thesis / viva stage, Pursuing Ph.D, No Ph.D, Not eligible, Not set. Sub-line "Eligible = With Ph.D." | **Applied post**: `applied_post`, case-insensitive merge, top 8 |
| **Data source**: `source` (Mam Data / Our Data / …), case-insensitive merge | **Reference source**: `source`, case-insensitive merge |
| **Interviews called by**: `called_by`, entries with a value only | **Call outcomes**: counts for Interview Scheduled, On Hold, RNR, Not Interested, No outcome |

"Case-insensitive merge" means grouping on `lower(trim(x))` and showing the most frequent original spelling as the label.

### 1.6 Candidate register

- Filters in one row:
  - Search box (name, email, phone, department as typed, remarks)
  - Status select
  - Department select. Its options follow the current department mode: groups or as-typed.
  - Eligibility select, teaching only
  - "Show removed rows" switch. Default off; when on, it includes entries with `is_active = false`.
- Sort by `applied_on` descending, nulls last. 25 rows per page using `components/ui/pagination.tsx`.
- Count line: "1,234 candidates".

**Teaching columns:**
- Name, with the email underneath in muted text
- Department: the group, with `dept_raw` underneath in small muted text when it differs
- Applied
- Eligibility: a chip, with `eligibility_raw` underneath when it differs
- Status chip
- Interview (`interview_on_raw`)
- Called by
- Resume: an "Open" link only when `resume_url` starts with `https://`, opening in a new tab with `rel="noopener noreferrer"`
- "In pipeline" badge when `application_id` is set

**NTS columns:**
- Name + email
- Applied post
- Department
- Call date
- Status chip, with a muted note "from remark" underneath when `status_from_remark`
- Remarks

- Clicking a row opens a side **sheet** (`components/ui/sheet.tsx`) with all fields. It includes a "Sheet row N" line and an "All columns" section rendering `raw` as a two-column list of header and value.
- Use a "Removed from sheet" badge on inactive entries.
- No edit controls anywhere.

### 1.7 Header, freshness and states

- Header line built from the summary response: `last_sync_at` (shown as local time, Asia/Calcutta) and `sheet_last_update` (shown as received).
- If `last_sync_at` is more than 60 minutes ago, show a warning banner: "The sheet hasn't synced since <time>. Recent edits in the sheet are not shown yet. Check the n8n Talent Pool sync workflow."
- **Refresh** button: re-fetches the summary and list through react-query `invalidateQueries`. It does not trigger a sync.
- Loading: skeleton rows in each panel. Error: per-panel message with the API error text and a Retry button. One failed panel must not blank the others.
- Empty state (no entries for the tab): reuse `components/dashboard/EmptyState.tsx` with "No candidates synced yet. The Talent Pool fills from the Google Sheet every 15 minutes once the n8n workflow is running."
- Must work at 400 px width without horizontal page scroll: tiles wrap, the two-column row stacks, and tables scroll inside their own containers.

---

## 2. Read API

Router `app/api/v1/routers/talent_pool.py`, registered in `app/api/v1/api.py`. Every route is gated with `require_roles(UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN)`. Pool entries have no campus, so campus scoping does not apply; note this in the router docstring.

All aggregation happens in SQL (`GROUP BY`), not in Python loops over rows. Each endpoint must answer in under 300 ms on 12,000 rows locally; add indexes if needed. The ones in the sync spec should be enough.

### 2.1 `GET /api/v1/talent-pool/summary`

Query: `source_tab` (required: `TEACHING_FINAL` | `NTS`), `dept_mode` (`group` | `raw`, default `group`; ignored for NTS), `include_inactive` (bool, default false).

```json
{
  "source_tab": "TEACHING_FINAL",
  "total": 7766,
  "by_status": { "Selected": 210, "Waiting List": 95, "Rejected": 1480, "Pending": 5981 },
  "by_eligibility": { "With Ph.D": 4203, "Thesis / viva stage": 310, "Pursuing Ph.D": 481,
                      "No Ph.D": 875, "Not eligible": 541, "Not set": 1356 },
  "eligible_definition": ["With Ph.D"],
  "eligible_pending": 3100,
  "by_department": [
    { "department": "ECE", "total": 1032, "eligible": 610, "selected": 30, "waiting": 12, "rejected": 200, "open": 790 }
  ],
  "department_mode": "group",
  "department_count": 33,
  "monthly": [ { "month": "2025-11", "added": 140, "selected": 6 } ],
  "undated": 412,
  "breakdowns": {
    "source": [ { "label": "Mam Data", "count": 3000 } ],
    "called_by": [ { "label": "Narmada", "count": 210 } ],
    "applied_post": [],
    "call_outcomes": []
  },
  "last_sync_at": "2026-10-21T11:30:00Z",
  "sheet_last_update": "14-10-2026, 04.51 pm",
  "last_sync_counts": { "inserted": 12, "updated": 30, "unchanged": 7700, "deactivated": 0 }
}
```

- `monthly` always has 12 entries, oldest first, with zeros for empty months.
- `breakdowns` lists are already ranked, top 8 plus an "Others" entry.
- Only the keys relevant to the tab are filled. The others are empty lists.
- `last_sync_at`, `sheet_last_update` and `last_sync_counts` come from the latest `TALENT_POOL_SYNCED` audit event for that tab. If the sync spec stored them elsewhere, use that and say so in the step report.

The example numbers above are illustrative, except `by_eligibility`, which are the real counts expected from the 2026-10-21 snapshot.

### 2.2 `GET /api/v1/talent-pool`

Query parameters:
- `source_tab` (required)
- `q`
- `sheet_status`
- `dept_mode` (`group` | `raw`)
- `department` (matched against `dept_group` or `dept_raw` per `dept_mode`, exact)
- `eligibility`
- `include_inactive` (default false)
- `page` (default 1)
- `page_size` (default 25, max 100)

Response follows the existing paginated list shape used by `GET /candidates` (check `app/schemas` and `api/types.ts`; do not invent a new envelope). Items include every column of the entry except `raw` and `content_hash`.

`q` uses ILIKE on `full_name`, `email`, `phone`, `dept_raw`, `applied_post`, `remarks`. Escape `%` and `_` in user input.

### 2.3 `GET /api/v1/talent-pool/{id}`

Returns the full entry including `raw`. 404 if not found.

### 2.4 Schemas

Pydantic models in `app/schemas/talent_pool.py`. Matching TypeScript types go in `frontend/src/api/types.ts`, and fetch functions in `frontend/src/api/talentPool.ts` using `apiFetch` from `@/api/client`, following `api/candidates.ts`.

---

## 3. Frontend structure

```
frontend/src/pages/TalentPoolPage.tsx            route component, tab + filter state from URL
frontend/src/api/talentPool.ts                   getTalentPoolSummary, listTalentPool, getTalentPoolEntry
frontend/src/components/talentPool/
  TalentPoolTiles.tsx
  MonthlyAddedChart.tsx
  DepartmentTable.tsx
  BreakdownList.tsx
  TalentPoolRegister.tsx
  TalentPoolEntrySheet.tsx
  statusTone.ts                                  status → tone map (success / warning / danger / info / neutral)
```

- Data fetching uses `@tanstack/react-query` (`useQuery`), with query keys `["talent-pool","summary",tab,deptMode]` and `["talent-pool","list",tab,filters,page]`. Debounce search by 300 ms.
- Route registered in `App.tsx` inside the authenticated layout, next to `/import-tracker`.
- Use existing `ui/` components (table, select, input, switch, badge, sheet, pagination, card). No new UI libraries.
- All digits in tables and tiles use tabular numerals.

---

## 4. Tests

**Backend** (`tests/`, pytest, existing fixtures). Seed about 30 entries across both tabs covering every status, eligibility value, an inactive row, a null `applied_on`, and two `dept_raw` spellings of one group.
- Summary totals equal hand-counted values; `monthly` has 12 entries; `undated` is correct.
- `dept_mode=raw` returns raw departments; `group` returns groups.
- `include_inactive` changes totals by exactly the inactive count.
- List filters combine (status + department + eligibility + q); pagination limits hold; `%` in `q` is treated literally.
- A non-admin user (for example a coordinator) gets 403 on every route; anonymous gets 401.
- `eligible_definition` matches the constant.

**Frontend** (vitest + testing-library, following `DashboardPage.test.tsx`):
- Renders tiles from a mocked summary; clicking "Eligible, no decision" sets both register filters.
- Department row click sets the department filter.
- The tab toggle switches the request's `source_tab` and clears filters.
- Stale banner appears when `last_sync_at` is 2 hours old and not when it is 5 minutes old.
- Empty state renders when `total = 0`.

**E2E (optional, Playwright in `e2e/`):** an admin logs in, opens /talent-pool, sees the tiles, switches to Non-teaching.

Type check with `npx tsc -b --force`.

---

## 5. Build order, with stop points

Stop after each step and report: files changed, tests run with results, anything that deviated from this spec.

**Step A: Read API.**
- Schemas, router, aggregation queries, backend tests.
- Done when the tests pass and `curl` with an admin token returns a summary for each tab against local seeded data.

**Step B: Page skeleton and data wiring.**
- Route, nav item, api module, page with tab toggle, header line, tiles, empty and error states.
- Done when the page loads both tabs from the local API, and `tsc` and the existing tests pass.

**Step C: Chart, department table, breakdowns.**
- Done when the numbers on screen equal the summary response for both tabs, the department toggle works, and the page has no horizontal scroll at 400 px.

**Step D: Register and entry sheet.**
- Done when filters, search, pagination, the tile and department click-through, and the side sheet with all columns work. Frontend tests pass.

**Step E: Deploy and verify with real data** (after sync-spec Step 5 has run at least once in production).
- Deploy per DEPLOYMENT.md.
- Done when Teaching total, Selected, Waiting list, Rejected, and the CSE department row on app.malathi.io/talent-pool match the Claude "Recruitment Desk" dashboard for the same moment. Differences must be explained only by the skipped and duplicate rows reported in the sync response.

---

## 6. Acceptance checklist (for Malathi)

- [ ] "Talent Pool" appears in the Recruitment menu for HR admins and not for other roles.
- [ ] Teaching and Non-teaching numbers match the Claude dashboard.
- [ ] CSE row (Grouped) shows the combined CSE/IT/MCA/BCA count; "As in sheet" shows every spelling separately.
- [ ] "Eligible, no decision" lists only With Ph.D candidates with no status, and clicking it filters the list.
- [ ] Editing a cell in the sheet shows on the page within about 15 minutes, after Refresh.
- [ ] Nothing on the page can edit a candidate.
- [ ] Works on a phone.
