"""Turns the clues docs/apps-script/resume-fields.gs sends into gender and state.

Resumes are private Drive files the server cannot open, so the script (which
runs as the user inside Google) sends only small CLUES -- a PIN, a state word, an
honorific, an explicit Gender field -- and this module, pure and database-free,
decides what they mean. Resume text and addresses never reach the server, and
no value here is ever worked out from a name.

Priority
  gender  explicit Gender/Sex field (high)  >  honorific (medium)  >  unknown
  state   PIN in the HOME address block (high)  >  state word in it (medium)  >  unknown

Every result carries a short `evidence` string ("PIN code 600077") and never
the address itself.
"""

import re
from dataclasses import dataclass

from app.data.pin_prefixes import AMBIGUOUS_PREFIX3, PIN_PREFIX2, PIN_PREFIX3, PIN_RANGES

# On since 9-Nov-2026: the spot-check showed most resumes give their place only
# in the contact lines at the top, so home-address-only left State nearly always
# unknown (the user's 2-Nov rule; their 9-Nov spec names the contact block). The
# home block still wins, and a contact value is LOW confidence, since it can be
# where the person lives or works now.
ACCEPT_CONTACT_BLOCK_STATE = True

SOURCE_FIELD = "resume_field"  # an explicit Gender/Sex field (not in the user's original list)
SOURCE_HONORIFIC = "resume_honorific"
SOURCE_PINCODE = "resume_pincode"
SOURCE_ADDRESS = "resume_address"
SOURCE_UNKNOWN = "unknown"

HIGH, MEDIUM, LOW = "high", "medium", "low"

STATES_AND_UTS: tuple[str, ...] = (
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat",
    "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
    "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab",
    "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh",
    "Uttarakhand", "West Bengal",
    "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu",
    "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
)  # fmt: skip

# Spelling variants, matched case-insensitively after punctuation is dropped.
_ALIASES: dict[str, str] = {
    "tamilnadu": "Tamil Nadu", "tamil nadu": "Tamil Nadu", "tamilnad": "Tamil Nadu",
    "pondicherry": "Puducherry", "pondy": "Puducherry", "puducherry": "Puducherry", "puduchery": "Puducherry",
    "orissa": "Odisha", "odisa": "Odisha",
    "telengana": "Telangana",
    "uttaranchal": "Uttarakhand", "uttarkhand": "Uttarakhand",
    "andhra": "Andhra Pradesh", "andra pradesh": "Andhra Pradesh",
    "jammu & kashmir": "Jammu and Kashmir", "jammu kashmir": "Jammu and Kashmir",
    "jammu": "Jammu and Kashmir", "kashmir": "Jammu and Kashmir",
    "andaman": "Andaman and Nicobar Islands", "andaman & nicobar islands": "Andaman and Nicobar Islands",
    "andaman and nicobar": "Andaman and Nicobar Islands", "andaman & nicobar": "Andaman and Nicobar Islands",
    "dadra and nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
    "daman and diu": "Dadra and Nagar Haveli and Daman and Diu", "daman & diu": "Dadra and Nagar Haveli and Daman and Diu",
    "new delhi": "Delhi", "nct of delhi": "Delhi",
    # Cities the script already recognised
    "chennai": "Tamil Nadu", "madras": "Tamil Nadu",
    "bengaluru": "Karnataka", "bangalore": "Karnataka",
    "hyderabad": "Telangana", "secunderabad": "Telangana",
    "mumbai": "Maharashtra", "bombay": "Maharashtra",
    "kolkata": "West Bengal", "calcutta": "West Bengal",
}  # fmt: skip
_ALIASES.update({state.lower(): state for state in STATES_AND_UTS})

# Two-letter codes are accepted ONLY as the whole clue, in capitals (the script
# sends the token it matched), never searched for inside longer text. UK is left
# out on purpose: in a resume it is as likely the United Kingdom.
_CODES: dict[str, str] = {
    "AP": "Andhra Pradesh", "AR": "Arunachal Pradesh", "AS": "Assam", "BR": "Bihar",
    "CG": "Chhattisgarh", "CH": "Chandigarh", "DL": "Delhi", "GA": "Goa", "GJ": "Gujarat",
    "HR": "Haryana", "HP": "Himachal Pradesh", "JK": "Jammu and Kashmir", "J&K": "Jammu and Kashmir",
    "JH": "Jharkhand", "KA": "Karnataka", "KL": "Kerala", "LD": "Lakshadweep", "MP": "Madhya Pradesh",
    "MH": "Maharashtra", "MN": "Manipur", "ML": "Meghalaya", "MZ": "Mizoram", "NL": "Nagaland",
    "OD": "Odisha", "OR": "Odisha", "PB": "Punjab", "PY": "Puducherry", "RJ": "Rajasthan",
    "SK": "Sikkim", "TN": "Tamil Nadu", "TS": "Telangana", "TG": "Telangana", "TR": "Tripura",
    "UP": "Uttar Pradesh", "WB": "West Bengal", "AN": "Andaman and Nicobar Islands",
    "LA": "Ladakh", "DN": "Dadra and Nagar Haveli and Daman and Diu",
}  # fmt: skip

# Longest alias first, so "andaman and nicobar islands" beats "andaman".
_ALIAS_SEARCH = re.compile(
    r"(?<![a-z])(" + "|".join(re.escape(a) for a in sorted(_ALIASES, key=len, reverse=True)) + r")(?![a-z])"
)


def _tidy(text: str) -> str:
    text = re.sub(r"[.,;:()\[\]]", " ", text.lower())
    text = re.sub(r"\s*-\s*", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalise_state(text: str | None) -> str | None:
    """A canonical state/UT name for a state word, or None. Exact variants and
    codes first; otherwise the earliest alias inside longer text (word-bounded)."""
    if not text or not text.strip():
        return None
    raw = text.strip()
    if raw in _CODES:
        return _CODES[raw]
    tidy = _tidy(raw)
    if tidy in _ALIASES:
        return _ALIASES[tidy]
    match = _ALIAS_SEARCH.search(tidy)
    return _ALIASES[match.group(1)] if match else None


def state_from_pin(pin: str | None) -> str | None:
    """The state/UT a six-digit PIN belongs to, or None when it is invalid, an
    Army Post number, or in a prefix shared between states."""
    if not pin:
        return None
    digits = re.sub(r"[\s-]", "", pin)
    if not re.fullmatch(r"[1-8]\d{5}", digits):
        return None
    number = int(digits)
    for low, high, state in PIN_RANGES:
        if low <= number <= high:
            return state or None
    prefix3 = digits[:3]
    if prefix3 in AMBIGUOUS_PREFIX3:
        return None
    return PIN_PREFIX3.get(prefix3) or PIN_PREFIX2.get(digits[:2])


def gender_from_field(value: str | None) -> str | None:
    if not value:
        return None
    key = value.strip().strip(".").lower()
    if key in ("f", "female"):
        return "Female"
    if key in ("m", "male"):
        return "Male"
    return None


# Not "Sri": it also opens many women's names ("Sri Devi", "Sri Lakshmi").
_MALE_TITLES = {"mr", "mister", "shri", "shree", "thiru"}
_FEMALE_TITLES = {"ms", "mrs", "miss", "smt", "selvi", "kumari", "tmt", "thirumathi", "srimathi", "shrimati"}
_TITLE_TOKEN = re.compile(r"[A-Za-z]+\.?")


def _honorific_hit(token: str | None) -> tuple[str, str] | None:
    """(gender, the token as written) for the first gendered title in `token`;
    None when there is none, or when titles of both genders conflict."""
    if not token:
        return None
    hits: list[tuple[str, str]] = []
    for part in _TITLE_TOKEN.findall(token):
        word = part.rstrip(".").lower()
        if word in _MALE_TITLES:
            hits.append(("Male", part))
        elif word in _FEMALE_TITLES:
            hits.append(("Female", part))
    if not hits or len({gender for gender, _ in hits}) > 1:
        return None
    return hits[0]


def gender_from_honorific(token: str | None) -> str | None:
    """Mr/Shri/Thiru -> Male; Ms/Mrs/Miss/Smt/Selvi/Kumari/Tmt/Thirumathi ->
    Female; "Dr" alone -> None, "Dr. (Mrs.)" -> Female. Never from a first name."""
    hit = _honorific_hit(token)
    return hit[0] if hit else None


@dataclass(frozen=True)
class Clues:
    gender_field: str | None = None
    honorific: str | None = None
    home_pin: str | None = None
    home_state_word: str | None = None
    contact_pin: str | None = None
    contact_state_word: str | None = None
    nationality_indian: bool = False


@dataclass(frozen=True)
class Inference:
    gender: str | None = None
    gender_source: str = SOURCE_UNKNOWN
    gender_confidence: str | None = None
    gender_evidence: str | None = None
    state: str | None = None
    state_source: str = SOURCE_UNKNOWN
    state_confidence: str | None = None
    state_evidence: str | None = None
    country: str | None = None


def _infer_gender(clues: Clues) -> tuple[str | None, str, str | None, str | None]:
    value = gender_from_field(clues.gender_field)
    if value:
        return value, SOURCE_FIELD, HIGH, f"Gender field '{value}'"
    hit = _honorific_hit(clues.honorific)
    if hit:
        return hit[0], SOURCE_HONORIFIC, MEDIUM, f"Honorific '{hit[1]}'"
    return None, SOURCE_UNKNOWN, None, None


def _infer_state(pin: str | None, word: str | None, prefix: str, confidence_shift: bool):
    state = state_from_pin(pin)
    if state:
        return state, SOURCE_PINCODE, LOW if confidence_shift else HIGH, f"{prefix}PIN code {re.sub(r'[^0-9]', '', pin)}"
    state = normalise_state(word)
    if state:
        return state, SOURCE_ADDRESS, LOW if confidence_shift else MEDIUM, f"{prefix}State word '{word.strip()}'"
    return None


def infer(clues: Clues) -> Inference:
    gender, gender_source, gender_confidence, gender_evidence = _infer_gender(clues)

    found = _infer_state(clues.home_pin, clues.home_state_word, "", False)
    if found is None and ACCEPT_CONTACT_BLOCK_STATE:
        found = _infer_state(clues.contact_pin, clues.contact_state_word, "Contact block: ", True)
    state = found[0] if found else None

    return Inference(
        gender=gender,
        gender_source=gender_source,
        gender_confidence=gender_confidence,
        gender_evidence=gender_evidence,
        state=state,
        state_source=found[1] if found else SOURCE_UNKNOWN,
        state_confidence=found[2] if found else None,
        state_evidence=found[3] if found else None,
        country="India" if state or clues.nationality_indian else None,
    )
