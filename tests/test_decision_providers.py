"""The JEV/openJEV seam: advisory, optional, and unable to overrule a rule.

No provider is configured in any deployment today, so the first test is the
one that matters most -- the default changes nothing. The rest pin the
contract a real provider will have to honour.
"""

import uuid

import pytest

from app.core.config import settings
from app.models.enums import (
    ChannelRecommendationSourceEnum,
    JobPostingChannelStatusEnum,
    RecruitmentChannelModeEnum,
)
from app.services import decision_providers, job_channels
from app.services.decision_providers import (
    ChannelAssessment,
    DecisionProvider,
    NullDecisionProvider,
    get_decision_provider,
)

INTERNAL = RecruitmentChannelModeEnum.INTERNAL
MANUAL = RecruitmentChannelModeEnum.MANUAL_ASSISTED


class _Opinionated(DecisionProvider):
    """A configured provider that answers about every channel it is shown,
    plus one it was not (which must be ignored)."""

    name = "jev-test"

    def __init__(self):
        self.saw: list[str] = []

    @property
    def is_configured(self) -> bool:
        return True

    def assess_channels(self, *, job_posting, channels):
        self.saw = [row.channel.code for row in channels]
        return [
            *[ChannelAssessment(row.channel.code, "strong fit", score=0.9) for row in channels],
            ChannelAssessment("NEVER_RECOMMENDED", "should be ignored", score=1.0),
        ]


class _Broken(DecisionProvider):
    name = "jev-broken"

    @property
    def is_configured(self) -> bool:
        return True

    def assess_channels(self, *, job_posting, channels):
        raise RuntimeError("the decision service is down")


def test_the_default_provider_is_none_and_has_no_opinion():
    assert settings.decision_provider == "none"
    provider = get_decision_provider()
    assert isinstance(provider, NullDecisionProvider)
    assert provider.is_configured is False
    assert provider.assess_channels(job_posting=None, channels=[]) == []


def test_an_unknown_provider_name_degrades_to_no_opinion(monkeypatch):
    """A typo in a config file must not stop a vacancy being advertised."""
    monkeypatch.setattr(settings, "DECISION_PROVIDER", "openjev-that-does-not-exist", raising=False)
    assert isinstance(get_decision_provider(), NullDecisionProvider)


def test_recommendation_is_unchanged_with_no_provider(
    db_session, published_vacancy_factory, recruitment_channel_factory, channel_rule_factory
):
    careers = recruitment_channel_factory("CAREERS_PAGE", mode=INTERNAL)
    faculty = recruitment_channel_factory("FACULTYPLUS", mode=MANUAL)
    channel_rule_factory("Careers page", [careers], auto_select=True)
    channel_rule_factory("Teaching posts", [faculty])
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1, live=False)

    rows = {row.channel.code: row for row in vacancy.job_posting.channels}
    assert set(rows) == {"CAREERS_PAGE", "FACULTYPLUS"}
    # The rule's own name, and nothing appended to it.
    assert rows["CAREERS_PAGE"].recommendation_reason == "Careers page"
    assert rows["FACULTYPLUS"].recommendation_reason == "Teaching posts"
    assert all(row.recommended_by is ChannelRecommendationSourceEnum.RULE for row in rows.values())


def test_a_configured_provider_annotates_but_cannot_change_the_selection(
    db_session, published_vacancy_factory, recruitment_channel_factory, channel_rule_factory, monkeypatch
):
    careers = recruitment_channel_factory("CAREERS_PAGE", mode=INTERNAL)
    faculty = recruitment_channel_factory("FACULTYPLUS", mode=MANUAL)
    channel_rule_factory("Careers page", [careers], auto_select=True)
    channel_rule_factory("Teaching posts", [faculty])

    provider = _Opinionated()
    monkeypatch.setitem(decision_providers._PROVIDERS, provider.name, lambda: provider)
    monkeypatch.setattr(settings, "DECISION_PROVIDER", provider.name, raising=False)

    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1, live=False)
    rows = {row.channel.code: row for row in vacancy.job_posting.channels}

    # It was consulted about exactly what the rules chose...
    assert sorted(provider.saw) == ["CAREERS_PAGE", "FACULTYPLUS"]
    # ...the rationale reached the recruiter, keeping the rule's name first...
    assert rows["CAREERS_PAGE"].recommendation_reason == "Careers page | jev-test: strong fit (score 0.9)"
    # ...and it changed nothing that matters: same channels, same statuses,
    # still attributed to the RULE, and its channel that no rule named is absent.
    assert set(rows) == {"CAREERS_PAGE", "FACULTYPLUS"}
    assert rows["CAREERS_PAGE"].status is JobPostingChannelStatusEnum.SELECTED
    assert rows["FACULTYPLUS"].status is JobPostingChannelStatusEnum.RECOMMENDED
    assert all(row.recommended_by is ChannelRecommendationSourceEnum.RULE for row in rows.values())


def test_a_provider_that_raises_is_ignored(
    db_session, published_vacancy_factory, recruitment_channel_factory, channel_rule_factory, monkeypatch
):
    """Advice is never worth failing a publish over."""
    careers = recruitment_channel_factory("CAREERS_PAGE", mode=INTERNAL)
    channel_rule_factory("Careers page", [careers], auto_select=True)
    monkeypatch.setitem(decision_providers._PROVIDERS, "jev-broken", _Broken)
    monkeypatch.setattr(settings, "DECISION_PROVIDER", "jev-broken", raising=False)

    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1, live=False)
    rows = {row.channel.code: row for row in vacancy.job_posting.channels}
    assert rows["CAREERS_PAGE"].recommendation_reason == "Careers page"
    assert rows["CAREERS_PAGE"].status is JobPostingChannelStatusEnum.SELECTED


def test_annotate_is_a_no_op_without_rows():
    assert decision_providers.annotate_recommendations(None, [], provider=_Opinionated()) == 0
