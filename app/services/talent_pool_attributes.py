"""The Selected breakdown's four people attributes, as SQL expressions.

College, State, Country and Gender have no columns of their own: they are read
from `TalentPoolEntry.raw`, which already keeps every column of the sheet row,
so a column added to the sheet is picked up by the next sync with no migration.

The panel's counts and the register's filters both use these expressions, so
clicking a bar lists exactly that bar's number.

College and Gender fall back to the linked New Joinees row when the talent pool
row has none. Values are only ever read from a sheet cell: gender is never
inferred from a name.
"""

from sqlalchemy import case, func, select

from app.models.sheet_sync import SheetJoinee
from app.models.talent_pool_entry import TalentPoolEntry


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


def college():
    return func.coalesce(
        func.upper(_cell(TalentPoolEntry.raw["College"].astext)),
        _from_joinee(SheetJoinee.campus_code),
    )


def state():
    return _tidied("State")


def country():
    return _tidied("Country")


def gender():
    value = func.coalesce(
        _cell(TalentPoolEntry.raw["Gender"].astext),
        _from_joinee(_cell(SheetJoinee.raw["Gender"].astext)),
    )
    lowered = func.lower(value)
    return case(
        (lowered.in_(("m", "male")), "Male"),
        (lowered.in_(("f", "female")), "Female"),
        else_=func.initcap(value),
    )
