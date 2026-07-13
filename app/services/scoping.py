"""Shared campus-scoping helper.

Extracted from app/services/hermes.py (Phase 4) so the same safety-critical
logic isn't duplicated in app/services/reporting.py (Phase 5): a
single-campus caller's requested campus_code is always ignored in favor of
their own CampusScope.campus_id, no matter what value was passed in.
"""

import uuid

from sqlalchemy.orm import Session

from app.core.deps import CampusScope
from app.models.campus import Campus
from app.models.enums import CAMPUS_CODES

# Nil UUID, never produced by gen_random_uuid() -- used as a filter value
# that deliberately matches zero rows, so an invalid campus_code from a
# global-scope caller returns an empty result set rather than an exception.
NO_CAMPUS_MATCH = uuid.UUID(int=0)


def resolve_campus_filter(db: Session, scope: CampusScope, campus_code: str | None) -> tuple[uuid.UUID | None, str]:
    """Returns (campus_id_filter, scope_note).

    campus_id_filter is a UUID to filter results to, or None for "no
    narrowing" (every campus the caller can see). For a single-campus
    caller, campus_code is always ignored -- the filter is always
    scope.campus_id -- regardless of what was passed as an argument.
    """
    if not scope.is_global:
        campus = db.get(Campus, scope.campus_id)
        label = campus.code if campus else "your campus"
        return scope.campus_id, f"Limited to your home campus ({label}). Any campus_code argument was ignored."

    if not campus_code:
        return None, "Global access: results span all campuses."

    campus = db.query(Campus).filter(Campus.code == campus_code.strip().upper()).one_or_none()
    if campus is None:
        return NO_CAMPUS_MATCH, (
            f"No campus found with code '{campus_code}'. Valid campus codes: {', '.join(CAMPUS_CODES)}."
        )
    return campus.id, f"Limited to campus {campus.code}."
