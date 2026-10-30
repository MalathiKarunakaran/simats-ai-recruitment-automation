# Talent pool sheet sync — Google Apps Script

`talent-pool-sheet-sync.gs` is the sync's sender when n8n cannot read the
sheet. It was written on 2026-10-29 because saveetha.com has Google Cloud
switched off, so a self-hosted n8n cannot get a Google sign-in (an OAuth
client needs a Cloud project). Apps Script runs as the sheet's owner, inside
the Workspace, so it needs neither.

It is a separate Apps Script project, not code inside the sheet's own
project: the sheet's project already holds other scripts
(`setSelectedStatusBatch`), and pasting over them would delete them. The
script opens the sheet by its ID.

It sends exactly what `docs/n8n/talent-pool-sheet-sync.workflow.json` sends
(same reshaping, checked against the same samples) to the same endpoint,
`POST https://api.malathi.io/api/v1/talent-pool/sync`, with the same
`X-Talent-Pool-Sync-Secret` header. Nothing in the app is specific to the
sender.

## Setup — once, as the sheet's owner (malathi@saveetha.com)

1. Open **https://script.new** signed in as malathi@saveetha.com. It opens
   a brand-new, empty project — not the sheet's own project, which holds
   other scripts that must not be overwritten.
2. Replace the placeholder `function myFunction() {}` with the whole of
   `talent-pool-sheet-sync.gs`, name the project `SIMATS talent pool sync`,
   and **Save**.
3. **Project Settings** (gear icon) → **Script properties** → **Add script
   property**: name `TALENT_POOL_SYNC_SECRET`, value = the part after `=` on
   that line of the server's `.env`
   (`grep TALENT_POOL_SYNC_SECRET /opt/simats/app/.env`). Save. The secret
   lives in the script's properties, never in its code.
4. **Editor** → choose `syncTalentPool` in the function list → **Run**.
   Google asks for permission once: it needs to read your spreadsheets,
   connect to an external service (the app) and run on a schedule.
5. Read the **Execution log**. A good first run prints two lines like
   `TEACHING_FINAL synced: {"received":7772,"inserted":7736,...,"skipped":36}`
   and `NTS synced: {...}`. Run it again: everything should be `unchanged`.
6. Choose `installTrigger` → **Run**. From then on it runs every 15 minutes
   (see **Triggers**, the clock icon). `removeTrigger` stops it.

## If a run fails

The script throws, so a scheduled failure is emailed to the owner. The
message carries the HTTP status:

| Status | Meaning | Fix |
|---|---|---|
| 401 | Secret differs from the server's | Run `checkSecret`: it must say length 64. Length 49 means the `grep` command itself was saved instead of its output (happened twice on 2026-10-29/30). Re-enter the script property |
| 502 | The backend worker was killed mid-request | Check `docker compose logs backend` for "Child process died". The "Final " tab takes ~13 s on the VPS, so uvicorn's health check must allow more than its default 5 s (`--timeout-worker-healthcheck`, 60 since `b56c0f8`) |
| 503 | `TALENT_POOL_SYNC_SECRET` not set on the server | Set it, then `docker compose up -d backend` |
| 422 "No 'Name' column" | The tab's header row changed | Check the header row; nothing was written |
| "Exception: ... UrlFetch" / permission error | The Workspace blocks scripts calling outside services | Ask IT to allow it, or use n8n with an OAuth client created by IT |

A failed run changes nothing; the Talent Pool keeps the previous sync.

## Changing it

Keep `buildSnapshot` identical to the n8n workflow's Code nodes, and change
both only together with `app/services/talent_pool_sync.py`.
