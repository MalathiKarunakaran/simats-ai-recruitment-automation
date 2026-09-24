"""Structured decision support: the seam JEV/openJEV plugs into (2026-09-24).

Generating text and making a judgement are different jobs, and this repo
keeps them apart. `ai_client` is the generation side: one OpenAI-compatible
client, prose out (a job description, poster copy). This module is the
decision side: a scored, structured opinion about something the system has
*already* decided by rule.

NOTHING IS CONFIGURED TODAY and `get_decision_provider()` returns
`NullDecisionProvider`, which has no opinion about anything. That is
deliberate, not unfinished. No openJEV deployment exists to call, and this
repo does not make an integration look real when it is not -- the same rule
the recruitment channels already follow, where an unreachable portal reports
NOT_CONFIGURED rather than a fake success. So the contract is defined, a test
proves a configured provider is consulted and cannot overrule the rules, and
the default answers nothing.

THE PROVIDER IS ADVISORY, ALWAYS. `job_channels.recommend_channels` attaches
exactly the channels its deterministic rules chose, and only then asks the
provider to annotate them. A provider cannot add a channel, remove one,
change a status, or select one for posting: those belong to the rules and to
the recruiter. `recommended_by` therefore stays RULE -- the rule really did
decide -- and `ChannelRecommendationSourceEnum.AI` remains unused until
something actually recommends on its own authority.

To add a real provider: implement `DecisionProvider`, register it in
`_PROVIDERS` under the name `DECISION_PROVIDER` will carry, and give it its
own settings. Nothing else changes.
"""

from collections.abc import Callable
from dataclasses import dataclass

from app.core.config import settings


@dataclass(frozen=True)
class ChannelAssessment:
    """One provider opinion about one channel already recommended by rule.

    `rationale` is what a recruiter reads next to the rule's name. `score` is
    optional because a provider that only explains itself is useful and a
    number nobody calibrated is not.
    """

    channel_code: str
    rationale: str
    score: float | None = None


class DecisionProvider:
    """A source of structured, advisory judgements."""

    name = "none"

    @property
    def is_configured(self) -> bool:
        """False means every call below returns nothing and callers carry on
        exactly as if this module did not exist."""
        return False

    def assess_channels(self, *, job_posting, channels) -> list[ChannelAssessment]:
        """Rank/justify channels a rule already chose. `channels` are
        `JobPostingChannel` rows; returning fewer than were asked about, or
        none, is normal. Must not mutate anything."""
        return []


class NullDecisionProvider(DecisionProvider):
    """The default: no provider, no opinion. Deterministic rules decide."""


# Name -> factory. A real provider (an openJEV HTTP service, a local scoring
# model) registers here; the name is what DECISION_PROVIDER is set to.
_PROVIDERS: dict[str, Callable[[], DecisionProvider]] = {
    "none": NullDecisionProvider,
}


def get_decision_provider() -> DecisionProvider:
    """Never raises and never returns None. An unrecognised DECISION_PROVIDER
    degrades to no opinion rather than breaking publication -- losing a
    rationale is a cosmetic loss, and a vacancy that cannot be advertised
    because of a typo in a config file is not."""
    factory = _PROVIDERS.get(settings.decision_provider)
    return factory() if factory else NullDecisionProvider()


def annotate_recommendations(job_posting, rows, *, provider: DecisionProvider | None = None) -> int:
    """Appends each assessment's rationale to the matching row's
    `recommendation_reason`, and returns how many rows were annotated.

    This is the ONLY thing a provider is allowed to do to a recommendation.
    A provider that raises is ignored: the rules' recommendations stand.
    """
    provider = provider or get_decision_provider()
    if not provider.is_configured or not rows:
        return 0
    try:
        assessments = provider.assess_channels(job_posting=job_posting, channels=list(rows))
    except Exception:  # noqa: BLE001 -- advice is never worth failing a publish over
        return 0

    by_code = {assessment.channel_code: assessment for assessment in assessments}
    annotated = 0
    for row in rows:
        assessment = by_code.get(row.channel.code)
        if assessment is None or not assessment.rationale:
            continue
        note = f"{provider.name}: {assessment.rationale}"
        if assessment.score is not None:
            note = f"{note} (score {assessment.score:g})"
        row.recommendation_reason = f"{row.recommendation_reason} | {note}" if row.recommendation_reason else note
        annotated += 1
    return annotated
