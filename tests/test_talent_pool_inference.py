"""Pure-function tests for services/talent_pool_inference.py (no database)."""

import pytest

from app.services import talent_pool_inference as inf
from app.services.talent_pool_inference import Clues, gender_from_field, gender_from_honorific, infer, normalise_state, state_from_pin


@pytest.mark.parametrize(
    "pin,state",
    [
        ("600077", "Tamil Nadu"), ("600 077", "Tamil Nadu"), ("641001", "Tamil Nadu"),
        ("400001", "Maharashtra"), ("403001", "Goa"), ("403601", "Goa"),
        ("605001", "Puducherry"), ("605014", "Puducherry"), ("605602", "Tamil Nadu"), ("605300", None),
        ("609602", "Puducherry"), ("609001", "Tamil Nadu"), ("607402", "Puducherry"), ("607401", "Tamil Nadu"),
        ("160017", "Chandigarh"), ("160062", "Punjab"), ("160102", "Chandigarh"), ("140301", "Punjab"), ("161001", "Punjab"),
        ("737101", "Sikkim"), ("734301", "West Bengal"), ("700001", "West Bengal"),
        ("682555", "Lakshadweep"), ("682001", "Kerala"), ("673310", "Puducherry"), ("673001", "Kerala"),
        ("744101", "Andaman and Nicobar Islands"), ("743001", "West Bengal"),
        ("795001", "Manipur"), ("793001", "Meghalaya"), ("799001", "Tripura"), ("797001", "Nagaland"),
        ("791001", "Arunachal Pradesh"), ("781001", "Assam"), ("796001", "Mizoram"),
        ("500001", "Telangana"), ("509001", "Telangana"), ("520001", "Andhra Pradesh"), ("533464", "Puducherry"),
        ("533001", "Andhra Pradesh"), ("560001", "Karnataka"), ("110001", "Delhi"),
        ("194101", "Ladakh"), ("190001", "Jammu and Kashmir"), ("180001", "Jammu and Kashmir"),
        ("248001", "Uttarakhand"), ("263001", "Uttarakhand"), ("226001", "Uttar Pradesh"),
        ("244001", None), ("247667", None), ("262501", None),
        ("834001", "Jharkhand"), ("800001", "Bihar"), ("814101", "Jharkhand"), ("811201", "Bihar"),
        ("396210", "Dadra and Nagar Haveli and Daman and Diu"), ("396001", "Gujarat"), ("362520", "Dadra and Nagar Haveli and Daman and Diu"),
        ("900001", None), ("012345", None), ("60007", None), ("6000777", None), ("abcdef", None), (None, None), ("", None),
    ],
)  # fmt: skip
def test_state_from_pin(pin, state):
    assert state_from_pin(pin) == state


@pytest.mark.parametrize(
    "text,state",
    [
        ("Tamil Nadu", "Tamil Nadu"), ("Tamilnadu", "Tamil Nadu"), ("TAMIL NADU", "Tamil Nadu"), ("tamil-nadu", "Tamil Nadu"),
        ("TN", "Tamil Nadu"), ("Pondicherry", "Puducherry"), ("Pondy", "Puducherry"), ("Orissa", "Odisha"),
        ("J&K", "Jammu and Kashmir"), ("AP", "Andhra Pradesh"), ("Bengaluru", "Karnataka"), ("Bangalore", "Karnataka"),
        ("Chennai", "Tamil Nadu"), ("Hyderabad", "Telangana"), ("Mumbai", "Maharashtra"), ("Kolkata", "West Bengal"),
        ("Chennai, Tamilnadu", "Tamil Nadu"), ("New Delhi", "Delhi"), ("Uttaranchal", "Uttarakhand"),
        ("Andaman and Nicobar Islands", "Andaman and Nicobar Islands"), ("Ladakh", "Ladakh"),
        # a two-letter code is only accepted as the whole clue, in capitals
        ("tn", None), ("Tn", None), ("I live in TN", None), ("goal", None), ("Goat farm", None),
        ("", None), (None, None), ("Atlantis", None),
    ],
)  # fmt: skip
def test_normalise_state(text, state):
    assert normalise_state(text) == state


def test_every_state_and_ut_normalises_to_itself():
    assert len(inf.STATES_AND_UTS) == 36
    for name in inf.STATES_AND_UTS:
        assert normalise_state(name) == name
    # and every PIN table value is one of the canonical names
    from app.data.pin_prefixes import PIN_PREFIX2, PIN_PREFIX3, PIN_RANGES

    values = set(PIN_PREFIX2.values()) | set(PIN_PREFIX3.values()) | {s for _, _, s in PIN_RANGES if s}
    assert values <= set(inf.STATES_AND_UTS)


@pytest.mark.parametrize(
    "token,gender",
    [
        ("Mr", "Male"), ("Mr.", "Male"), ("MR.", "Male"), ("Shri", "Male"), ("Thiru", "Male"), ("Sri", None),
        ("Ms", "Female"), ("Ms.", "Female"), ("Mrs.", "Female"), ("Miss", "Female"), ("Smt", "Female"), ("Selvi", "Female"),
        ("Kumari", "Female"), ("Tmt.", "Female"), ("Thirumathi", "Female"),
        ("Dr", None), ("Dr.", None), ("Prof.", None), ("Dr. (Mrs.)", "Female"), ("Dr. Mr.", "Male"),
        ("Mr. & Mrs.", None), ("", None), (None, None), ("Priya", None), ("Kumar", None),
    ],
)  # fmt: skip
def test_gender_from_honorific(token, gender):
    assert gender_from_honorific(token) == gender


@pytest.mark.parametrize("value,gender", [("F", "Female"), ("female", "Female"), ("M", "Male"), ("Male ", "Male"), ("x", None), (None, None)])
def test_gender_from_field(value, gender):
    assert gender_from_field(value) == gender


def test_no_clues_is_unknown():
    result = infer(Clues())
    assert (result.gender, result.state, result.country) == (None, None, None)
    assert result.gender_source == result.state_source == inf.SOURCE_UNKNOWN
    assert result.gender_evidence is None and result.state_evidence is None


def test_explicit_field_beats_honorific():
    result = infer(Clues(gender_field="Female", honorific="Mr."))
    assert (result.gender, result.gender_source, result.gender_confidence) == ("Female", "resume_field", "high")
    assert result.gender_evidence == "Gender field 'Female'"


def test_honorific_is_medium_and_names_the_token():
    result = infer(Clues(honorific="Ms."))
    assert (result.gender, result.gender_source, result.gender_confidence) == ("Female", "resume_honorific", "medium")
    assert result.gender_evidence == "Honorific 'Ms.'"
    assert infer(Clues(honorific="Dr.")).gender is None


def test_pin_beats_state_word_and_gives_country():
    result = infer(Clues(home_pin="600077", home_state_word="Kerala"))
    assert (result.state, result.state_source, result.state_confidence) == ("Tamil Nadu", "resume_pincode", "high")
    assert result.state_evidence == "PIN code 600077"
    assert result.country == "India"


def test_state_word_is_medium_and_an_ambiguous_pin_falls_back_to_it():
    result = infer(Clues(home_pin="244001", home_state_word="Tamilnadu"))
    assert (result.state, result.state_source, result.state_confidence) == ("Tamil Nadu", "resume_address", "medium")
    assert result.state_evidence == "State word 'Tamilnadu'"


def test_nationality_alone_gives_country_only():
    result = infer(Clues(nationality_indian=True))
    assert (result.country, result.state) == ("India", None)


def test_contact_block_is_accepted_at_low_confidence(monkeypatch):
    clues = Clues(contact_pin="682001", contact_state_word="Kerala")
    assert inf.ACCEPT_CONTACT_BLOCK_STATE is True
    accepted = infer(clues)
    assert (accepted.state, accepted.state_confidence) == ("Kerala", "low")
    assert accepted.state_evidence.startswith("Contact block: ")
    monkeypatch.setattr(inf, "ACCEPT_CONTACT_BLOCK_STATE", False)
    assert infer(clues).state is None
    # the home block still wins over the contact block
    both = Clues(home_state_word="Goa", contact_pin="682001", contact_state_word="Kerala")
    assert infer(both).state == "Goa"
