"""Saves what resumes state, sent by docs/apps-script/resume-fields.gs.

Matched to candidates by the Drive file id in their resume link, because sheet
row numbers move. Limited to Selected rows of the Final tab, which is all the
script reads. Saving again overwrites, so the script can safely be re-run.

Two payload shapes. An item with `clues` is turned into values by
talent_pool_inference.infer (source, confidence and a short evidence note are
stored with each value). An item without them is the original shape, already
decided by the script, and is stored as-is; it also refreshes the frozen
`legacy_*` columns that the sheet-only view reads.

An item whose `resume_hash` equals the stored one is skipped, so an unchanged
resume is not processed twice. A value is never erased by an unknown: if the
new reading finds nothing where the original reader had found something, the
original value stays.
"""

import logging
import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import TalentPoolSourceTabEnum
from app.models.talent_pool_entry import TalentPoolEntry
from app.models.talent_pool_resume_field import TalentPoolResumeField
from app.schemas.talent_pool_sync import ResumeFieldsItem, ResumeFieldsRequest, ResumeFieldsResult
from app.services import talent_pool_inference as inference

logger = logging.getLogger(__name__)

_FILE_ID = re.compile(r"[?&]id=([\w-]+)|/d/([\w-]+)")


def _entries_by_file(db: Session) -> dict[str, list]:
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
    return entries_by_file


def stored_hashes(db: Session) -> dict[str, str]:
    """{file_id: resume_hash} for every file the script would read, so it can
    skip unchanged ones before opening them."""
    by_file = _entries_by_file(db)
    entry_ids = [entry_id for ids in by_file.values() for entry_id in ids]
    if not entry_ids:
        return {}
    hash_by_entry = dict(
        db.execute(
            select(TalentPoolResumeField.talent_pool_entry_id, TalentPoolResumeField.resume_hash).where(
                TalentPoolResumeField.talent_pool_entry_id.in_(entry_ids),
                TalentPoolResumeField.resume_hash.is_not(None),
            )
        ).all()
    )
    out: dict[str, str] = {}
    for file_id, ids in by_file.items():
        hashes = {hash_by_entry.get(entry_id) for entry_id in ids}
        if len(hashes) == 1 and None not in hashes:
            out[file_id] = hashes.pop()
    return out


def _apply_legacy_shape(row: TalentPoolResumeField, item: ResumeFieldsItem) -> None:
    row.gender, row.state, row.country = item.gender, item.state, item.country
    row.legacy_gender, row.legacy_state, row.legacy_country = item.gender, item.state, item.country
    row.gender_source = inference.SOURCE_FIELD if item.gender else None
    row.gender_confidence = inference.HIGH if item.gender else None
    row.gender_evidence = None
    row.state_source = inference.SOURCE_ADDRESS if item.state else None
    row.state_confidence = None
    row.state_evidence = None
    row.resume_hash = item.resume_hash
    row.inferred_at = None


def _apply_clues(row: TalentPoolResumeField, item: ResumeFieldsItem, now: datetime) -> None:
    c = item.clues
    result = inference.infer(
        inference.Clues(
            gender_field=c.gender_field,
            honorific=c.honorific,
            home_pin=c.home_pin,
            home_state_word=c.home_state_word,
            contact_pin=c.contact_pin,
            contact_state_word=c.contact_state_word,
            nationality_indian=c.nationality_indian,
        )
    )
    # Never erase what the original reader had found with a reading that finds nothing.
    keep_gender = result.gender is None and row.legacy_gender is not None and row.gender == row.legacy_gender
    keep_state = result.state is None and row.legacy_state is not None and row.state == row.legacy_state
    if not keep_gender:
        row.gender = result.gender
        row.gender_source = result.gender_source if result.gender else None
        row.gender_confidence = result.gender_confidence
        row.gender_evidence = result.gender_evidence
    if not keep_state:
        row.state = result.state
        row.state_source = result.state_source if result.state else None
        row.state_confidence = result.state_confidence
        row.state_evidence = result.state_evidence
        row.country = result.country
    elif result.country and not row.country:
        row.country = result.country
    # An explicit Gender field is the original reader's own rule, so it counts there too.
    if result.gender_source == inference.SOURCE_FIELD:
        row.legacy_gender = result.gender
    row.resume_hash = item.resume_hash
    row.inferred_at = now


def save(db: Session, payload: ResumeFieldsRequest) -> ResumeFieldsResult:
    entries_by_file = _entries_by_file(db)
    wanted = {entry_id for item in payload.items for entry_id in entries_by_file.get(item.file_id, [])}
    existing = (
        {
            row.talent_pool_entry_id: row
            for row in db.execute(
                select(TalentPoolResumeField).where(TalentPoolResumeField.talent_pool_entry_id.in_(wanted))
            ).scalars()
        }
        if wanted
        else {}
    )

    now = datetime.now(timezone.utc)
    saved = unmatched = processed = skipped = errors = state_filled = gender_filled = 0
    for item in payload.items:
        entry_ids = entries_by_file.get(item.file_id)
        if not entry_ids:
            unmatched += 1
            continue
        todo = [
            entry_id
            for entry_id in entry_ids
            if not (
                item.resume_hash
                and entry_id in existing
                and existing[entry_id].resume_hash == item.resume_hash
            )
        ]
        if not todo:
            skipped += 1
            continue
        written = []
        try:
            with db.begin_nested():
                for entry_id in todo:
                    row = existing.get(entry_id)
                    if row is None:
                        row = TalentPoolResumeField(talent_pool_entry_id=entry_id)
                        db.add(row)
                    if item.clues is not None:
                        _apply_clues(row, item, now)
                    else:
                        _apply_legacy_shape(row, item)
                    written.append(row)
        except Exception:
            logger.exception("resume-fields: could not save file %s", item.file_id)
            errors += 1
            continue
        for entry_id, row in zip(todo, written):
            existing[entry_id] = row
        saved += len(written)
        state_filled += sum(row.state is not None for row in written)
        gender_filled += sum(row.gender is not None for row in written)
        processed += 1

    logger.info(
        "resume-fields: processed=%d state_filled=%d gender_filled=%d skipped=%d errors=%d",
        processed, state_filled, gender_filled, skipped, errors,
    )  # fmt: skip
    return ResumeFieldsResult(
        received=len(payload.items),
        saved=saved,
        no_matching_candidate=unmatched,
        processed=processed,
        state_filled=state_filled,
        gender_filled=gender_filled,
        skipped=skipped,
        errors=errors,
    )
