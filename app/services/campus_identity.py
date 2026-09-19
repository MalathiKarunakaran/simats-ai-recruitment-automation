"""Who a campus is on a printed page (2026-09-18).

The recruitment posters SIMATS actually prints carry a fixed identity block
per campus: a logo lockup, an accreditation line, a postal address, the
recruitment mailbox, the website and a tagline. None of it comes from the
recruitment data -- it is the same on every poster that campus prints, and it
changes about once a year -- so it lives here as constants rather than in a
table with a migration, a CRUD screen and an audit trail nobody would use.

Move it into the database the day a campus needs to edit its own address
without a deploy. Until then this is the smaller, honest version.

The TEXT below was read off the campus's own posters (see the SSE entry).
The IMAGE files are not in the repo yet: `asset_path` returns None for a
file that is missing and `campaign_poster` draws a labelled placeholder in
its place, so the poster renders end to end before the real artwork lands.
Drop the real files in and nothing else changes.
"""

from dataclasses import dataclass
from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "assets"
CAMPUS_ASSETS = ASSETS / "campus"


@dataclass(frozen=True)
class CampusIdentity:
    code: str
    # "SIMATS ENGINEERING" -- the campus's own name as it is printed, which is
    # not always what the database calls the campus.
    display_name: str
    # "ENGINEER TO EXCEL" -- sits under the logo mark.
    motto: str | None
    # "NBA Tier 1 | IET-UK | ABET Accreditation"
    accreditation: str | None
    postal_address: tuple[str, ...]
    location_line: str
    recruitment_email: str
    website: str
    tagline: tuple[str, ...]

    def asset_path(self, name: str) -> Path | None:
        """`logo.png`, `seal.png` or `campus.jpg` for this campus, or None
        while the file has not been supplied yet."""
        candidate = CAMPUS_ASSETS / self.code / name
        return candidate if candidate.is_file() else None


# Read off the campus's own 2026 recruitment posters. Correct these here if a
# poster is ever printed with something different.
SSE = CampusIdentity(
    code="SSE",
    display_name="SIMATS ENGINEERING",
    motto="ENGINEER TO EXCEL",
    accreditation="NBA Tier 1  |  IET-UK  |  ABET Accreditation",
    postal_address=(
        "Recruitment Team - SIMATS Engineering,",
        "Saveetha Institute of Medical and Technical Sciences,",
        "Saveetha Nagar, Thandalam Campus,",
        "Chennai - 602 105",
    ),
    location_line="Thandalam Campus, Chennai - 602105",
    recruitment_email="recruitment.sse@saveetha.com",
    website="www.saveetha.com",
    tagline=("Shape Minds.", "Shape Tomorrow."),
)


def _fallback(code: str, name: str) -> CampusIdentity:
    """A campus whose identity block has not been written yet still prints a
    poster -- with the institute's own details rather than SSE's, because a
    SCLAS poster carrying the engineering mailbox would send applications to
    the wrong desk."""
    return CampusIdentity(
        code=code,
        display_name=name.upper(),
        motto=None,
        accreditation=None,
        postal_address=(
            "Recruitment Team,",
            "Saveetha Institute of Medical and Technical Sciences,",
            "Chennai - 602 105",
        ),
        location_line="Chennai - 602105",
        recruitment_email="recruitment@saveetha.com",
        website="www.saveetha.com",
        tagline=(),
    )


IDENTITIES: dict[str, CampusIdentity] = {SSE.code: SSE}


def identity_for(campus) -> CampusIdentity:
    return IDENTITIES.get(campus.code) or _fallback(campus.code, campus.name)
