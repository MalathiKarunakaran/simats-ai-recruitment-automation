"""New Joinees + Pro App Order sheet sync endpoints (2026-10-30), step 2 of
docs/specs/joinee-order-sync.md.

The POST is machine-only and gated by the SAME shared secret as the talent
pool sync (same sender). The two GETs are for the Super Admin status page.
The router commits, because get_db never does.
"""

import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_roles, require_talent_pool_sync_secret
from app.models.audit_log import AuditLog
from app.models.enums import TALENT_POOL_SYNCED_ACTION, UserRoleEnum
from app.models.sheet_sync import SheetSyncRun
from app.schemas.sheet_sync import (
    SheetSyncRequest,
    SheetSyncResult,
    SheetSyncRunOut,
    SheetSyncSource,
    SheetSyncStatusItem,
)
from app.services import sheet_sync
from app.services.xlsx_safety import harden_workbook

router = APIRouter(prefix="/sheet-sync", tags=["sheet-sync"])

_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _run_out(run: SheetSyncRun | None) -> SheetSyncRunOut | None:
    if run is None:
        return None
    return SheetSyncRunOut(
        id=str(run.id),
        source=run.source,
        dry_run=run.dry_run,
        created_at=run.created_at,
        counts={k: v for k, v in (run.counts or {}).items() if isinstance(v, int)},
        missing_headers=list(run.missing_headers or []),
    )


@router.post(
    "/{source}",
    response_model=SheetSyncResult,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_talent_pool_sync_secret)],
)
def sync_source(source: SheetSyncSource, payload: SheetSyncRequest, db: Session = Depends(get_db)) -> SheetSyncResult:
    try:
        result = sheet_sync.apply_snapshot(db, source, payload, payload.dry_run)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    db.commit()
    return result


@router.get("/runs", response_model=list[SheetSyncStatusItem])
def latest_runs(
    db: Session = Depends(get_db),
    _user=Depends(require_roles(UserRoleEnum.SUPER_ADMIN)),
) -> list[SheetSyncStatusItem]:
    items: list[SheetSyncStatusItem] = []
    # Talent pool S1/S2: the last TALENT_POOL_SYNCED audit row per tab.
    rows = db.execute(
        select(AuditLog).where(AuditLog.action == TALENT_POOL_SYNCED_ACTION).order_by(desc(AuditLog.created_at)).limit(50)
    ).scalars()
    last_by_tab: dict[str, AuditLog] = {}
    for row in rows:
        tab = (row.after_state or {}).get("source_tab")
        if isinstance(tab, str) and tab not in last_by_tab:
            last_by_tab[tab] = row
    for tab, row in sorted(last_by_tab.items()):
        counts = {k: v for k, v in ((row.after_state or {}).get("counts") or {}).items() if isinstance(v, int)}
        items.append(
            SheetSyncStatusItem(
                source=f"TALENT_POOL_{tab}",
                last_run=SheetSyncRunOut(id=None, source=f"TALENT_POOL_{tab}", dry_run=False, created_at=row.created_at, counts=counts),
                last_dry_run=None,
            )
        )
    for src in SheetSyncSource:
        def latest(dry: bool, _s=src.value):
            return db.execute(
                select(SheetSyncRun)
                .where(SheetSyncRun.source == _s, SheetSyncRun.dry_run.is_(dry))
                .order_by(desc(SheetSyncRun.created_at))
                .limit(1)
            ).scalar_one_or_none()

        items.append(SheetSyncStatusItem(source=src.value, last_run=_run_out(latest(False)), last_dry_run=_run_out(latest(True))))
    return items


@router.get("/runs/{run_id}/flagged.xlsx")
def flagged_xlsx(
    run_id: str,
    db: Session = Depends(get_db),
    _user=Depends(require_roles(UserRoleEnum.SUPER_ADMIN)),
) -> StreamingResponse:
    import uuid

    try:
        run = db.get(SheetSyncRun, uuid.UUID(run_id))
    except ValueError:
        run = None
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync run not found")
    wb = Workbook()
    ws = wb.active
    ws.title = "Flagged rows"
    ws.append(["Row", "Key", "Reason"])
    for f in run.flagged or []:
        ws.append([f.get("row_number"), f.get("key"), f.get("reason")])
    harden_workbook(wb)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    stamp = datetime.now(timezone.utc)
    return StreamingResponse(
        buf,
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="simats-{run.source.lower()}-flagged-{stamp:%Y%m%d}.xlsx"'},
    )
