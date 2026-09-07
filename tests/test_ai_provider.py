"""The AI provider switch (2026-09-07, RMS step 6).

`AI_PROVIDER` decides who answers every generation call and
`EMBEDDING_PROVIDER` who computes resume vectors. These tests pin the
selection logic and the two local-model accommodations (Qwen3's thinking
preamble is switched off per request and stripped from any answer) without
ever reaching a live server: the client factory is inspected, not called.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.services import ai_client, vector_store


@pytest.fixture()
def ollama(monkeypatch):
    monkeypatch.setattr(settings, "AI_PROVIDER", "ollama", raising=False)
    monkeypatch.setattr(settings, "EMBEDDING_PROVIDER", "ollama", raising=False)
    monkeypatch.setattr(settings, "OLLAMA_BASE_URL", "http://ollama-host:11434/", raising=False)
    monkeypatch.setattr(settings, "OLLAMA_MODEL", "qwen3:4b", raising=False)
    monkeypatch.setattr(settings, "OLLAMA_EMBEDDING_MODEL", "bge-m3", raising=False)


@pytest.fixture()
def openai_configured(monkeypatch):
    monkeypatch.setattr(settings, "AI_PROVIDER", "openai", raising=False)
    monkeypatch.setattr(settings, "EMBEDDING_PROVIDER", "chroma", raising=False)
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-test", raising=False)
    monkeypatch.setattr(settings, "OPENAI_MODEL", "gpt-4o", raising=False)


# --- generation provider --------------------------------------------------


def test_openai_stays_the_default_and_needs_its_key(monkeypatch):
    monkeypatch.setattr(settings, "AI_PROVIDER", "openai", raising=False)
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "", raising=False)

    with pytest.raises(HTTPException) as exc:
        ai_client.get_openai_client()

    assert exc.value.status_code == 503
    assert "OPENAI_API_KEY" in exc.value.detail


def test_openai_client_carries_the_openai_model(openai_configured):
    client = ai_client.get_openai_client()

    assert "api.openai.com" in str(client.base_url)
    assert settings.ai_model == "gpt-4o"
    assert ai_client._provider_extra() == {}


def test_ollama_client_points_at_the_servers_openai_endpoint(ollama):
    client = ai_client.get_openai_client()

    assert str(client.base_url).rstrip("/") == "http://ollama-host:11434/v1"
    assert client.api_key == "ollama"  # no key needed; the SDK refuses an empty one
    assert client.timeout == settings.OLLAMA_TIMEOUT_SECONDS
    assert settings.ai_model == "qwen3:4b"


def test_ollama_requests_switch_reasoning_off(ollama):
    """`reasoning_effort: "none"` is what Ollama's OpenAI-compatible endpoint
    honours (proven live 2026-09-07); `think: false` there is ignored and
    leaves `content` empty."""
    assert ai_client._provider_extra() == {"reasoning_effort": "none"}


def test_ollama_needs_a_base_url(ollama, monkeypatch):
    monkeypatch.setattr(settings, "OLLAMA_BASE_URL", "  ", raising=False)

    with pytest.raises(HTTPException) as exc:
        ai_client.get_openai_client()

    assert exc.value.status_code == 503
    assert "OLLAMA_BASE_URL" in exc.value.detail


def test_unknown_provider_is_a_clear_503_not_a_crash(monkeypatch):
    monkeypatch.setattr(settings, "AI_PROVIDER", "bedrock", raising=False)

    with pytest.raises(HTTPException) as exc:
        ai_client.get_openai_client()

    assert exc.value.status_code == 503
    assert "bedrock" in exc.value.detail


def test_provider_name_is_case_and_space_insensitive(monkeypatch):
    monkeypatch.setattr(settings, "AI_PROVIDER", " Ollama ", raising=False)
    assert settings.ai_provider == "ollama"
    monkeypatch.setattr(settings, "AI_PROVIDER", "", raising=False)
    assert settings.ai_provider == "openai"


def test_every_generation_call_uses_the_configured_model(ollama):
    """Each chat call must pass `settings.ai_model` and the provider extras,
    or a switch to Ollama would still name gpt-4o and fail. Checked through
    the real functions with a recording fake."""
    seen: list[dict] = []

    def create(**kwargs):
        seen.append(kwargs)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='{"questions": []}', tool_calls=None))]
        )

    fake = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))

    ai_client.generate_interview_questions(fake, jd_text="JD", interview_type="TECHNICAL", resume_text=None)
    ai_client.generate_narrative_openai(fake, system="s", user_content="u")
    ai_client.call_with_tools_openai(fake, messages=[], tools=[])

    assert len(seen) == 3
    for kwargs in seen:
        assert kwargs["model"] == "qwen3:4b"
        assert kwargs["reasoning_effort"] == "none"


# --- Qwen3 thinking preamble ---------------------------------------------


def test_thinking_block_is_stripped_before_json_is_parsed():
    response = SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content='<think>\nLet me reason...\n</think>\n{"eligibility_score": 80}')
            )
        ]
    )
    assert ai_client._parse_openai_structured_json(response) == {"eligibility_score": 80}


def test_thinking_block_is_stripped_from_narratives():
    response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="<think>hmm</think>  Two hires this week."))]
    )
    fake = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **kw: response)))

    assert ai_client.generate_narrative_openai(fake, system="s", user_content="u") == "Two hires this week."


def test_an_answer_that_is_only_thinking_is_an_unexpected_response():
    response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="<think>...</think>"))])

    with pytest.raises(HTTPException) as exc:
        ai_client._parse_openai_structured_json(response)

    assert exc.value.status_code == 502


def test_plain_answers_are_untouched():
    assert ai_client._strip_thinking('{"a": 1}') == '{"a": 1}'


# --- embedding provider ---------------------------------------------------


def test_chroma_default_keeps_the_original_collection_and_function(openai_configured):
    assert vector_store.collection_name() == settings.CHROMA_COLLECTION_RESUMES
    assert vector_store.embedding_function() is None


def test_ollama_embeddings_get_their_own_collection(ollama):
    """Vectors from two models are not comparable, so a switch must never
    query the old collection with new-model vectors."""
    assert vector_store.collection_name() == f"{settings.CHROMA_COLLECTION_RESUMES}_ollama_bge_m3"

    fn = vector_store.embedding_function()

    assert type(fn).__name__ == "OllamaEmbeddingFunction"


def test_unknown_embedding_provider_is_a_clear_503(monkeypatch):
    monkeypatch.setattr(settings, "EMBEDDING_PROVIDER", "cohere", raising=False)

    with pytest.raises(HTTPException) as exc:
        vector_store.embedding_function()

    assert exc.value.status_code == 503
    assert "cohere" in exc.value.detail
