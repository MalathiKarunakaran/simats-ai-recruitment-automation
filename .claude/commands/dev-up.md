---
description: Start the full local dev stack (Postgres/MinIO/ChromaDB via Docker, migrations, seed check, backend uvicorn, frontend Vite dev server).
---

Bring up the local dev environment for the SIMATS AI Recruitment Automation
System, in this order, checking each step actually succeeded before moving
to the next rather than assuming:

1. Start the Docker-managed services:
   ```bash
   docker compose up -d
   ```
   Wait for `postgres`, `minio`, `chromadb` to report healthy
   (`docker compose ps`) — they have healthchecks, don't just assume `up -d`
   returning means they're ready.

2. Apply migrations:
   ```bash
   venv/Scripts/python.exe -m alembic upgrade head
   ```

3. Check whether seed data already exists before reseeding (seeding is
   idempotent and safe to re-run, but note in your report whether this ran
   fresh or was a no-op):
   ```bash
   venv/Scripts/python.exe -m app.db.seed
   ```

4. Start the backend API in the background:
   ```bash
   venv/Scripts/python.exe -m uvicorn app.main:app --reload
   ```
   Confirm it's actually serving: `curl http://127.0.0.1:8000/health` should
   return `{"status": "ok"}`.

5. Start the frontend dev server in the background:
   ```bash
   npm run dev
   ```
   (run from `frontend/`). It should come up on `http://localhost:5173`.

Report back: which services are running and on which ports (Postgres 5434,
MinIO 9000/9001, ChromaDB 8012, backend 8000, frontend 5173), whether seed
data was freshly created or already present, and the Swagger UI URL
(`http://127.0.0.1:8000/docs`) for manual verification. If any step fails,
stop and report the actual error rather than continuing to the next step.
