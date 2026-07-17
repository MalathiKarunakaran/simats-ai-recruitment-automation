---
description: Run the full test suite (backend pytest, frontend tsc -b --force, frontend Vitest) and report a pass/fail summary for each.
---

Run every verification check this repo actually has, in this order, and
report a clear pass/fail for each — don't stop at the first failure, run all
three and report the full picture:

1. Backend tests:
   ```bash
   venv/Scripts/python.exe -m pytest -v
   ```
   (Requires the `simats_recruitment_test` Postgres database to already
   exist — if this fails with a database-does-not-exist error, that's the
   likely cause; the one-time creation command is in `README.md`'s
   Verification section, not something to silently work around.)

2. Frontend type-check — use `npx tsc -b --force`, **never** bare
   `tsc --noEmit` (the root `tsconfig.json` has `"files": []` and needs
   project-reference build mode to actually check anything — see
   `CLAUDE.md`):
   ```bash
   cd frontend && npx tsc -b --force
   ```

3. Frontend tests:
   ```bash
   cd frontend && npm run test
   ```

Report, for each of the three: pass/fail, test/error counts if shown, and
the specific failing test names or type errors if any failed. Note that a
couple of Vitest tests are known to occasionally flake on worker-pool
startup contention — if a failure looks like a timing/startup issue, re-run
just that file in isolation before reporting it as a real regression.
