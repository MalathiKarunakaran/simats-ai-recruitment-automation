"""The Selected breakdown's four people attributes, as SQL expressions.

College, State, Country and Gender have no columns of their own: they are read
from `TalentPoolEntry.raw`, which already keeps every column of the sheet row,
so a column added to the sheet is picked up by the next sync with no migration.

The panel's counts and the register's filters both use these expressions, so
clicking a bar lists exactly that bar's number.

College and Gender fall back to the linked New Joinees row when the talent pool
row has none. Gender, State and Country then fall back to what the resume states
(TalentPoolResumeField), so a sheet value always wins. Gender is never inferred
from a name.
"""

from sqlalchemy import and_, case, func, select

from app.models.sheet_sync import SheetJoinee
from app.models.talent_pool_entry import TalentPoolEntry
from app.models.enums import TalentPoolSourceTabEnum
from app.models.talent_pool_resume_field import TalentPoolResumeField
from app.models.talent_pool_source_ref import TalentPoolSourceRef
from app.services.talent_pool_sources import FACULTY_PLUS


def _cell(column):
    return func.nullif(func.btrim(column), "")


def _tidied(header: str):
    """Same spelling in any case or spacing counts as one value."""
    return func.initcap(func.regexp_replace(_cell(TalentPoolEntry.raw[header].astext), r"\s+", " ", "g"))


def _from_joinee(value):
    # A person can be linked from more than one joinee row: latest joining wins.
    return (
        select(value)
        .where(SheetJoinee.talent_pool_entry_id == TalentPoolEntry.id, SheetJoinee.is_active.is_(True), value.is_not(None))
        .order_by(SheetJoinee.joined_on.desc().nulls_last(), SheetJoinee.id)
        .limit(1)
        .correlate(TalentPoolEntry)
        .scalar_subquery()
    )


def _from_resume(column):
    return (
        select(column)
        .where(TalentPoolResumeField.talent_pool_entry_id == TalentPoolEntry.id)
        .correlate(TalentPoolEntry)
        .scalar_subquery()
    )


def _source_for(key):
    return (
        select(TalentPoolSourceRef.source)
        .where(TalentPoolSourceRef.match_key == key)
        .correlate(TalentPoolEntry)
        .scalar_subquery()
    )


def data_source():
    """Final only, where Reference says just Mam Data or Our Data. Mam Data is
    Faculty Plus; the rest take their source from the TS tab, by email and then
    phone, and stay null when TS does not list them. NTS's Reference is already
    the source, so it has no second value here."""
    digits = func.regexp_replace(TalentPoolEntry.phone, r"\D", "", "g")
    return case(
        (TalentPoolEntry.source_tab != TalentPoolSourceTabEnum.TEACHING_FINAL, None),
        (func.lower(func.btrim(TalentPoolEntry.source)) == "mam data", FACULTY_PLUS),
        else_=func.coalesce(
            _source_for("e:" + func.lower(func.btrim(TalentPoolEntry.email))),
            _source_for("p:" + func.right(digits, 10)),
        ),
    )


def college():
    return func.coalesce(
        func.upper(_cell(TalentPoolEntry.raw["College"].astext)),
        _from_joinee(SheetJoinee.campus_code),
    )


def state():
    return func.coalesce(_tidied("State"), _from_resume(TalentPoolResumeField.state))


def country():
    return func.coalesce(_tidied("Country"), _from_resume(TalentPoolResumeField.country))


def _gender_from_sheets():
    return func.coalesce(
        _cell(TalentPoolEntry.raw["Gender"].astext),
        _from_joinee(_cell(SheetJoinee.raw["Gender"].astext)),
    )


def gender():
    value = func.coalesce(_gender_from_sheets(), _from_resume(TalentPoolResumeField.gender))
    lowered = func.lower(value)
    return case(
        (lowered.in_(("m", "male")), "Male"),
        (lowered.in_(("f", "female")), "Female"),
        else_=func.initcap(value),
    )


# True when the value above came from the resume, for the "from resumes" count.
def state_from_resume():
    return and_(_tidied("State").is_(None), _from_resume(TalentPoolResumeField.state).is_not(None))


def country_from_resume():
    return and_(_tidied("Country").is_(None), _from_resume(TalentPoolResumeField.country).is_not(None))


def gender_from_resume():
    return and_(_gender_from_sheets().is_(None), _from_resume(TalentPoolResumeField.gender).is_not(None))
