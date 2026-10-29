"""Talent pool sheet sync endpoint (2026-10-29), step 2 of
docs/specs/talent-pool-sheet-sync.md.

The machine-only writer of `talent_pool_entries`, kept apart from the read
router (`talent_pool.py`, which stays read-only on purpose: no screen may
edit a pool entry). n8n posts one full snapshot of one tab every 15 minutes;
`services/talent_pool_sync.py` does the work.

Gated by a shared secret, not a user -- see deps.require_talent_pool_sync_secret.
Returns 200 with the counts, also for a replay that changes nothing, so n8n
never retries a success. The router commits, because get_db never does: a
missing commit would pass every test and lose every sync (CLAUDE.md).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_talent_pool_sync_secret
from app.schemas.talent_pool_sync import TalentPoolSyncRequest, TalentPoolSyncResult
from app.services import talent_pool_sync

router = APIRouter(prefix="/talent-pool", tags=["talent-pool"])


@router.post(
    "/sync",
    response_model=TalentPoolSyncResult,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_talent_pool_sync_secret)],
)
def sync_tab(payload: TalentPoolSyncRequest, db: Session = Depends(get_db)) -> TalentPoolSyncResult:
    try:
        result = talent_pool_sync.apply_snapshot(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    db.commit()
    return result
