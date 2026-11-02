"""Saves what resumes state, sent by docs/apps-script/resume-fields.gs.

Matched to candidates by the Drive file id in their resume link, because sheet
row numbers move. Limited to Selected rows of the Final tab, which is all the
script reads. Saving again overwrites, so the script can safely be re-run.
"""

import re

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.enums import TalentPoolSourceTabEnum
from app.models.talent_pool_entry import TalentPoolEntry
from app.models.talent_pool_resume_field import TalentPoolResumeField
from app.schemas.talent_pool_sync import ResumeFieldsRequest, ResumeFieldsResult

_FILE_ID = re.compile(r"[?&]id=([\w-]+)|/d/([\w-]+)")


def save(db: Session, payload: ResumeFieldsRequest) -> ResumeFieldsResult:
    entries_by_file: dict[str, list] = {}
    rows = db.execute(
        select(TalentPoolEntry.id, TalentPoolEntry.resume_url).where(
            TalentPoolEntry.source_tab == TalentPoolSourceTabEnum.TEACHING_FINAL,
            TalentPoolEntry.is_active.is_(True),
            TalentPoolEntry.sheet_status == "Selected",
            TalentPoolEntry.resume_url.is_not(None),
        )
    ).all()
    for entry_id, url in rows:
        match = _FILE_ID.search(url)
        if match:
            entries_by_file.setdefault(match.group(1) or match.group(2), []).append(entry_id)

    saved = unmatched = 0
    for item in payload.items:
        entry_ids = entries_by_file.get(item.file_id)
        if not entry_ids:
            unmatched += 1
            continue
        values = {"gender": item.gender, "state": item.state, "country": item.country}
        for entry_id in entry_ids:
            db.execute(
                insert(TalentPoolResumeField)
                .values(talent_pool_entry_id=entry_id, **values)
                .on_conflict_do_update(index_elements=["talent_pool_entry_id"], set_=values)
            )
            saved += 1
    return ResumeFieldsResult(received=len(payload.items), saved=saved, no_matching_candidate=unmatched)
