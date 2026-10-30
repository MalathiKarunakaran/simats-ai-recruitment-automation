# Email through n8n — setup

Decided 2026-10-30: the app's email goes out through the self-hosted n8n
(`/opt/n8n`, https://n8n.malathi.io) over **SMTP from a saveetha.com
mailbox**, and **only the sign-in code is emailed for now**.

## What the app sends, and what n8n does with it

The app posts JSON to `N8N_BASE_URL/<path>` (`app/services/n8n_client.py`).
Setting `N8N_BASE_URL` switches all of these on at once, so n8n decides what
actually becomes an email:

| Path | Sent by | Payload | n8n today |
|---|---|---|---|
| `send-otp-email` | sign-in by emailed code (`auth.py`) | `to`, `full_name`, `code` | **`send-otp-email.workflow.json` emails it** |
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

### 1. The mailbox (Google, as the mailbox's owner)

1. The sending account needs **2-Step Verification** on
   (myaccount.google.com → Security).
2. Create an **App password** (myaccount.google.com/apppasswords), name it
   `n8n SIMATS`. Google shows 16 letters once. If the page says app
   passwords are not available, saveetha.com IT has disabled them; ask IT to
   allow them for this account.

### 2. In n8n (https://n8n.malathi.io)

1. **Credentials → Add credential → SMTP**, name `SIMATS mailbox (SMTP)`:
   User = the full address, Password = the app password, Host
   `smtp.gmail.com`, Port `465`, SSL/TLS on. Save (n8n tests it).
2. **Workflows → Import from File** → `docs/n8n/send-otp-email.workflow.json`.
3. Open **Send the code**: pick the credential, and replace
   `CHANGE-ME@saveetha.com` in *From Email* with the same address. Save.
4. Switch the workflow **Active**.

### 3. On the server (once)

- `/opt/n8n/docker-compose.yml`: the `n8n` service joins the external
  network `app_default` as well as its own; `docker compose up -d`.
- `/etc/caddy/Caddyfile`, `n8n.malathi.io` block: `respond /webhook* 404`
  before `reverse_proxy`; `caddy validate`, then `systemctl reload caddy`.
- `/opt/simats/app/.env`: `N8N_BASE_URL=http://n8n:5678/webhook`, then
  `docker compose up -d --force-recreate backend`.

Do step 2 before the `.env` line: once `N8N_BASE_URL` is set the login page
offers "email me a code", and without an active workflow every request for
one fails.

### 4. Check

On app.malathi.io's login page choose the email-code option with your own
address. The code should arrive within a minute, and the n8n execution list
shows the run. Gmail's limit for a Workspace account is about 2,000 messages
a day.

## Turning on notifications later

Write a `notify` workflow that maps `notification_type` to who gets what,
review the wording of each of the 16 types first, and decide whether
candidate-facing ones (selected / rejected / withdrawn) are emailed at all.
