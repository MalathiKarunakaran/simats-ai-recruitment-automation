# Email through n8n — setup

Decided 2026-10-30: the app's email goes out through the self-hosted n8n
(`/opt/n8n`, https://n8n.malathi.io), and **only the sign-in code is emailed
for now**. n8n hands each email to an **Apps Script mail relay**
(`docs/apps-script/mail-relay.gs`) that sends it with Gmail as the
saveetha.com account that deployed it. SMTP was the first plan, but
saveetha.com has 2-Step Verification, and so app passwords, switched off;
Google Cloud is off too, which rules out n8n's Gmail sign-in.

## What the app sends, and what n8n does with it

The app posts JSON to `N8N_BASE_URL/<path>` (`app/services/n8n_client.py`).
Setting `N8N_BASE_URL` switches all of these on at once, so n8n decides what
actually becomes an email:

| Path | Sent by | Payload | n8n today |
|---|---|---|---|
| `send-otp-email` | sign-in by emailed code (`auth.py`) | `to`, `full_name`, `code` | **`send-otp-email.workflow.json` has the mail relay email it** |
| `send-password-reset-email` | password reset (`auth.py`) | `to`, `full_name`, `token` | no workflow; the app has no reset page yet, and answers 503 |
| `notify` | 16 workflow events (`notifications.py`) | `notification_type`, `channel`, `recipient_email`, `subject`, `body`, … | no workflow, so n8n answers 404 and the app records the notification FAILED — nothing is emailed until a reviewed workflow exists |
| distribution paths | job-portal posting (`job_channels.py`, `channel_providers.py`) | posting details | no workflow, as before |

A path with no active workflow answers 404 and the app treats it as "not
delivered": a code request gets 503 "Email login is currently unavailable",
a notification is stored FAILED. Nothing is ever reported sent that was not.

## How the app reaches n8n — never through the public URL

`N8N_BASE_URL=http://n8n:5678/webhook`. The n8n container also joins the
app's Docker network (`app_default`), so the backend calls it directly.
Caddy answers 404 for `/webhook*` on n8n.malathi.io: an open webhook would
let anyone on the internet make the SIMATS mailbox send mail.

## Setup

### 1. The mail relay (Apps Script, as malathi@saveetha.com)

1. **script.new** → new project `SIMATS mail relay`; paste
   `docs/apps-script/mail-relay.gs`; Save.
2. **Project Settings → Script properties**: `RELAY_SECRET` = a new random
   64-character value (the same value goes into n8n in step 2).
3. Run `testSendToMe` once: Google asks permission to send email as you,
   and a test email arrives in your inbox.
4. **Deploy → New deployment → Web app**: Execute as **Me**, Who has access
   **Anyone**; Deploy; copy the **Web app URL** (ends in `/exec`). If
   "Anyone" is not offered, saveetha.com only allows web apps inside the
   domain and the relay cannot be reached from the server.

The relay builds each message itself from a fixed template per `kind`
(only `otp` today), so even a leaked secret can only send "your sign-in code
is NNNNNN"; it also caps 5 codes per address per 10 minutes and 200 sends an
hour. Gmail's own limit for the account is about 1,500 recipients a day.

### 2. In n8n (https://n8n.malathi.io)

1. **Credentials → Add credential → Custom Auth**, name
   `SIMATS mail relay secret`, JSON: `{"body": {"secret": "<RELAY_SECRET>"}}`.
2. **Workflows → Import from File** → `docs/n8n/send-otp-email.workflow.json`.
3. Open **Mail relay sends the code**: paste the Web app URL into *URL* and
   pick the credential. Save.
4. Switch the workflow **Active**.

### 3. On the server (once)

- `/opt/n8n/docker-compose.yml`: the `n8n` service joins the external
  network `app_default` as well as its own (done 2026-10-30).
- `/etc/caddy/Caddyfile`, `n8n.malathi.io` block: `respond /webhook* 404`
  before `reverse_proxy` (done 2026-10-30).
- `/opt/simats/app/.env`: `N8N_BASE_URL=http://n8n:5678/webhook` and
  `N8N_TIMEOUT_SECONDS=20` (Apps Script can take a few seconds to wake),
  then `docker compose up -d --force-recreate backend` (done 2026-10-30;
  `/auth/login-options` then reports `otp_email_login: true`).

Do steps 1 and 2 before the `.env` lines: once `N8N_BASE_URL` is set the
login page offers "email me a code", and without an active workflow every
request for one fails.

### 4. Check

On app.malathi.io's login page choose the email-code option with your own
address. The code should arrive within a minute; n8n's execution list and
the relay's Executions page both show the run.

## Turning on notifications later

Write a `notify` workflow that maps `notification_type` to who gets what,
review the wording of each of the 16 types first, and decide whether
candidate-facing ones (selected / rejected / withdrawn) are emailed at all.
