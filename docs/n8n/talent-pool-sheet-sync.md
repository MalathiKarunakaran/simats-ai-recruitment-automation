# Talent pool sheet sync — n8n setup

Step 3 of `docs/specs/talent-pool-sheet-sync.md`. The workflow in
`talent-pool-sheet-sync.workflow.json` reads the recruitment sheet's
`Final ` and `NTS` tabs every 15 minutes and posts each, whole, to
`POST https://api.malathi.io/api/v1/talent-pool/sync`. The app works out what
changed; n8n only reshapes Google's grid.

What it can and cannot change: only the Talent Pool table, and only the rows
the sync itself created. Candidates, applications, users, settings and any
Talent Pool row entered by hand are never touched. A person who disappears
from the sheet is marked "removed from sheet", never deleted.

## Why the workflow reads the raw grid

It calls Google's `values.get` through an HTTP Request node, with your own
Google Sheets sign-in, instead of the Google Sheets "read rows" node. That
node turns rows into named fields, which drops columns with no header (NTS
has three) and loses the sheet row numbers. The two Code nodes turn the grid
into the snapshot the app expects: the header row (row 2 on `Final `, row 1 on
`NTS`), every non-empty row with its sheet row number, and on `Final ` the
"Last Date Update" cells C1 and D1.

## 1. On the server — once, before the workflow is switched on

The sync endpoint exists only once commit `4d36df9` (and the three before it)
is deployed. Deploy as `DEPLOYMENT.md` sections 2–3 say:

```bash
cd /opt/simats/app
git pull --ff-only origin master
git log --oneline -1          # must show 4d36df9 or later
```

Make the shared secret and add it to the server's `.env` (the same file
`DEPLOYMENT.md` section 1 describes; nothing else in it changes):

```bash
openssl rand -hex 32          # copy the output; this is the secret
nano .env                     # add one line: TALENT_POOL_SYNC_SECRET=<the output>
```

Then rebuild and restart. The backend applies the two new migrations by
itself on start (three empty columns on `applications`, one on
`talent_pool_entries`; no existing row is edited):

```bash
docker compose build
docker compose up -d
```

## 2. In n8n — import and connect

1. **Workflows → Import from File**, choose
   `docs/n8n/talent-pool-sheet-sync.workflow.json`. It imports switched off.
2. Open **Read 'Final ' tab**. Under *Credential for Google Sheets OAuth2
   API*, pick your existing Google Sheets sign-in, or **Create new** and sign
   in as the account that owns the sheet. Do the same on **Read 'NTS' tab**
   (it can be the same credential).
3. Open **Send Final to app**. Under *Credential for Header Auth*, **Create
   new**:
   - Name: `X-Talent-Pool-Sync-Secret`
   - Value: the secret from step 1

   Pick that same credential on **Send NTS to app**.
4. **Save**.

## 3. Test once, then switch on

1. Click **Run now (test)** → **Test workflow**.
2. Open **Send Final to app** and **Send NTS to app** and read their output.
   On the first run `counts.inserted` should be about the sheet's candidate
   count (Final ≈ 7,700, NTS ≈ 2,760), `counts.skipped` the rows with no name
   (≈ 36 on Final), and `unmapped_departments` normally empty. Run it a
   second time: everything should be `unchanged`.
3. Switch the workflow **Active**. From then on it runs every 15 minutes.
4. On app.malathi.io the Talent Pool page now shows when it was last synced.

## If a Send node fails

| HTTP status | Meaning | Fix |
|---|---|---|
| 404 | The endpoint is not deployed yet | Do section 1 |
| 503 | `TALENT_POOL_SYNC_SECRET` is not set on the server | Add it to `.env`, then `docker compose up -d backend` |
| 401 | The secret in n8n does not match the server's | Re-enter it in the Header Auth credential |
| 422 "No 'Name' column" | The tab's header row changed, or the wrong row was read | Check the sheet's header row; nothing was written |

A failed run changes nothing; the page keeps the previous sync's data.

## Changing the workflow

Edit the Code nodes only together with `apply_snapshot` in
`app/services/talent_pool_sync.py` — the snapshot shape is defined there
(`app/schemas/talent_pool_sync.py`). Columns are matched by header name on
the app side, so a column added to the sheet needs no change here.
